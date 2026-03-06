// Cloudflare Worker - Reddit Scraper
// Supports Sort-Based OR Date-Based filtering based on user preference

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/scrape") {
      try {
        const body = await request.json();
        const subreddit  = body.subreddit      || "Overwatch";
        const limit      = Math.min(100, body.limit          || 25);
        const commentsPerPost = Math.min(50,  body.commentsPerPost || 20);
        const startDate  = body.startDate      || null;
        const endDate    = body.endDate        || null;
        const sortBy     = body.sortBy         || null;
        const timeFilter = body.timeFilter     || "all";
        const filterMode = body.filterMode     || ((startDate || endDate) ? "date" : "sort");

        const result = await scrapeReddit(
          subreddit, limit, commentsPerPost,
          startDate, endDate, sortBy, timeFilter, filterMode
        );

        return new Response(JSON.stringify(result), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    return new Response("Reddit Scraper Worker is running.", {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};

async function scrapeReddit(subreddit, limit, commentsPerPost, startDate, endDate, sortBy, timeFilter, filterMode) {
  const posts      = [];
  const allComments = [];
  const dailyStats  = {};

  if (filterMode === "date") {
    const startDateTime = startDate ? new Date(startDate + "T00:00:00Z") : null;
    const endDateTime   = endDate   ? new Date(endDate   + "T23:59:59Z") : null;

    // Fetch up to 1000 posts sorted by new; stop early once older than startDate
    const rawPosts = await getPostsChronological(subreddit, 1000, startDateTime);

    for (const post of rawPosts) {
      const postDate = new Date(post.created_utc);

      // Posts come newest-first; once older than startDate we can stop
      if (startDateTime && postDate < startDateTime) break;
      // Skip posts that are newer than endDate
      if (endDateTime && postDate > endDateTime) continue;

      posts.push(post);
      const dateKey = post.created_utc.split("T")[0];
      dailyStats[dateKey] = (dailyStats[dateKey] || 0) + 1;
      if (posts.length >= limit) break;
    }

  } else {
    // SORT MODE — no date filtering at all
    const actualSort = sortBy || "new";
    const rawPosts   = await getPostsBySort(subreddit, limit, actualSort, timeFilter);

    for (const post of rawPosts) {
      posts.push(post);
      const dateKey = post.created_utc.split("T")[0];
      dailyStats[dateKey] = (dailyStats[dateKey] || 0) + 1;
      if (posts.length >= limit) break;
    }
  }

  // Fetch comments for every collected post
  for (const post of posts) {
    const comments = await getComments(post.permalink, commentsPerPost);
    for (const c of comments) {
      c.post_title = post.title;
      c.post_url   = post.url;
      c.post_id    = post.id;
      c.post_date  = post.created_utc.split("T")[0];
    }
    allComments.push(...comments);
  }

  return {
    posts,
    comments: allComments,
    dailyStats,
    stats: {
      totalPosts:    posts.length,
      totalComments: allComments.length,
      filterMode,
      sortBy:     filterMode === "sort" ? (sortBy || "new") : "new (date mode)",
      timeFilter: filterMode === "sort" ? timeFilter : "N/A",
      dateRange: {
        start: startDate || "No limit",
        end:   endDate   || "No limit"
      },
      scrapedAt: new Date().toISOString()
    }
  };
}

// For DATE mode: fetch newest posts and stop once we pass startDate
async function getPostsChronological(subreddit, maxPosts, stopBeforeDate) {
  const allPosts = [];
  let after = null;

  while (allPosts.length < maxPosts) {
    try {
      let url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100&raw_json=1`;
      if (after) url += `&after=${after}`;

      const res = await fetch(url, {
        headers: { "User-Agent": "RedditScraper/1.0 (Cloudflare Worker)" }
      });

      if (!res.ok) {
        console.error(`Reddit API error: ${res.status}`);
        break;
      }

      const data     = await res.json();
      const children = data?.data?.children || [];
      if (children.length === 0) break;

      let hitBoundary = false;

      for (const child of children) {
        const p        = child.data;
        if (p.stickied || p.over_18) continue;

        const postTime = new Date((p.created_utc || 0) * 1000);

        // Stop entirely once posts are older than our start date
        if (stopBeforeDate && postTime < stopBeforeDate) {
          hitBoundary = true;
          break;
        }

        allPosts.push(buildPost(p));
        if (allPosts.length >= maxPosts) break;
      }

      after = data?.data?.after;
      if (!after || hitBoundary) break;

    } catch (e) {
      console.error("Fetch error:", e.message);
      break;
    }
  }

  return allPosts;
}

// For SORT mode: fetch by sort type
async function getPostsBySort(subreddit, maxPosts, sortBy, timeFilter) {
  const allPosts = [];
  let after = null;

  const sortMap     = { hot: "hot", new: "new", top: "top", rising: "rising", best: "best" };
  const sortEndpoint = sortMap[sortBy] || "new";

  while (allPosts.length < maxPosts) {
    try {
      let url = `https://www.reddit.com/r/${subreddit}/${sortEndpoint}.json?limit=100&raw_json=1`;
      if (sortBy === "top") url += `&t=${timeFilter}`;
      if (after) url += `&after=${after}`;

      const res = await fetch(url, {
        headers: { "User-Agent": "RedditScraper/1.0 (Cloudflare Worker)" }
      });

      if (!res.ok) {
        console.error(`Reddit API error: ${res.status}`);
        break;
      }

      const data     = await res.json();
      const children = data?.data?.children || [];
      if (children.length === 0) break;

      for (const child of children) {
        const p = child.data;
        if (p.stickied || p.over_18) continue;
        allPosts.push(buildPost(p));
        if (allPosts.length >= maxPosts) break;
      }

      after = data?.data?.after;
      if (!after) break;

    } catch (e) {
      console.error("Fetch error:", e.message);
      break;
    }
  }

  return allPosts;
}

// Shared post builder
function buildPost(p) {
  return {
    id:           p.id            || "",
    title:        p.title         || "",
    author:       p.author        || "[deleted]",
    score:        p.score         || 0,
    upvote_ratio: p.upvote_ratio  || 0,
    num_comments: p.num_comments  || 0,
    created_utc:  new Date((p.created_utc || 0) * 1000).toISOString(),
    url:          p.url           || "",
    permalink:    p.permalink     || "",
    selftext:     p.selftext      || "",
    is_self:      p.is_self       || false,
    flair:        p.link_flair_text || "N/A",
    domain:       p.domain        || "reddit.com",
    thumbnail:    p.thumbnail     || "",
    awards:       p.total_awards_received || 0
  };
}

// Fetch comments for a post
async function getComments(permalink, limit) {
  try {
    const res = await fetch(
      `https://www.reddit.com${permalink}.json?limit=500&raw_json=1`,
      { headers: { "User-Agent": "RedditScraper/1.0 (Cloudflare Worker)" } }
    );

    if (!res.ok) return [];

    const data         = await res.json();
    const commentsData = data[1]?.data?.children || [];
    const comments     = [];

    function extract(list, depth) {
      if (comments.length >= limit) return;
      for (const child of list) {
        if (child.kind !== "t1") continue;
        const c    = child.data;
        const body = c.body || "";
        if (!body || body === "[deleted]" || body === "[removed]") continue;

        comments.push({
          id:           c.id            || "",
          author:       c.author        || "[deleted]",
          text:         body,
          score:        c.score         || 0,
          created_utc:  new Date((c.created_utc || 0) * 1000).toISOString(),
          depth,
          parent_id:    c.parent_id     || "",
          is_submitter: c.is_submitter  || false,
          awards:       c.total_awards_received || 0
        });

        if (depth < 2 && comments.length < limit && c.replies?.data) {
          extract(c.replies.data.children || [], depth + 1);
        }
      }
    }

    extract(commentsData, 0);
    return comments.slice(0, limit);
  } catch (e) {
    return [];
  }
}
