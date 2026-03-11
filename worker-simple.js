// Cloudflare Worker - Reddit Scraper
// Supports Sort-Based OR Date-Based filtering + Cursor-Based Pagination

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
        const subreddit = body.subreddit || "Overwatch";
        const limit = Math.min(100, body.limit || 25);
        const commentsPerPost = Math.min(50, body.commentsPerPost || 20);
        const startDate = body.startDate || null;
        const endDate = body.endDate || null;
        const sortBy = body.sortBy || null;
        const timeFilter = body.timeFilter || "all";
        const filterMode = body.filterMode || ((startDate || endDate) ? "date" : "sort");
        const afterCursor = body.afterCursor || null; // ← NEW

        const result = await scrapeReddit(
          subreddit, limit, commentsPerPost,
          startDate, endDate, sortBy, timeFilter, filterMode, afterCursor
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

async function scrapeReddit(subreddit, limit, commentsPerPost, startDate, endDate, sortBy, timeFilter, filterMode, afterCursor) {
  const posts = [];
  const allComments = [];
  const dailyStats = {};
  let nextCursor = null; // ← NEW: will be returned to browser

  if (filterMode === "date") {
    const startDateTime = startDate ? new Date(startDate + "T00:00:00Z") : null;
    const endDateTime = endDate ? new Date(endDate + "T23:59:59Z") : null;

    // ← CHANGED: now returns { posts, nextCursor }
    const { posts: rawPosts, nextCursor: cursor } = await getPostsChronological(subreddit, 1000, startDateTime, afterCursor);
    nextCursor = cursor;

    for (const post of rawPosts) {
      const postDate = new Date(post.created_utc);
      if (startDateTime && postDate < startDateTime) break;
      if (endDateTime && postDate > endDateTime) continue;

      posts.push(post);
      const dateKey = post.created_utc.split("T")[0];
      dailyStats[dateKey] = (dailyStats[dateKey] || 0) + 1;
      if (posts.length >= limit) break;
    }

  } else {
    const actualSort = sortBy || "new";

    // ← CHANGED: now returns { posts, nextCursor }
    const { posts: rawPosts, nextCursor: cursor } = await getPostsBySort(subreddit, limit, actualSort, timeFilter, afterCursor);
    nextCursor = cursor;

    for (const post of rawPosts) {
      posts.push(post);
      const dateKey = post.created_utc.split("T")[0];
      dailyStats[dateKey] = (dailyStats[dateKey] || 0) + 1;
      if (posts.length >= limit) break;
    }
  }

 const commentPromises = posts.map(async (post) => {
  const comments = await getComments(post.permalink, commentsPerPost);

  return comments.map(c => ({
    ...c,
    post_title: post.title,
    post_url: post.url,
    post_id: post.id,
    post_date: post.created_utc.split("T")[0]
  }));
});

const commentsResults = await Promise.all(commentPromises);
commentsResults.forEach(c => allComments.push(...c)); 

  return {
    posts,
    comments: allComments,
    dailyStats,
    nextCursor, // ← NEW: browser saves this for next call
    stats: {
      totalPosts: posts.length,
      totalComments: allComments.length,
      filterMode,
      sortBy: filterMode === "sort" ? (sortBy || "new") : "new (date mode)",
      timeFilter: filterMode === "sort" ? timeFilter : "N/A",
      dateRange: {
        start: startDate || "No limit",
        end: endDate || "No limit"
      },
      scrapedAt: new Date().toISOString()
    }
  };
}

// ← CHANGED: accepts initialAfter, returns { posts, nextCursor }
async function getPostsChronological(subreddit, maxPosts, stopBeforeDate, initialAfter) {
  const allPosts = [];
  let after = initialAfter || null;
  let lastAfter = null;

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

      const data = await res.json();
      const children = data?.data?.children || [];
      if (children.length === 0) break;

      let hitBoundary = false;

      for (const child of children) {
        const p = child.data;
        if (p.stickied || p.over_18) continue;

        const postTime = new Date((p.created_utc || 0) * 1000);
        if (stopBeforeDate && postTime < stopBeforeDate) {
          hitBoundary = true;
          break;
        }

        allPosts.push(buildPost(p));
        if (allPosts.length >= maxPosts) break;
      }

      lastAfter = data?.data?.after || null;
      after = lastAfter;
      if (!after || hitBoundary) break;

    } catch (e) {
      console.error("Fetch error:", e.message);
      break;
    }
  }

  return { posts: allPosts, nextCursor: lastAfter }; // ← CHANGED
}

// ← CHANGED: accepts initialAfter, returns { posts, nextCursor }
async function getPostsBySort(subreddit, maxPosts, sortBy, timeFilter, initialAfter) {
  const allPosts = [];
  let after = initialAfter || null;
  let lastAfter = null;

  const sortMap = { hot: "hot", new: "new", top: "top", rising: "rising", best: "best" };
  
  let sortEndpoint = sortMap[sortBy] || "new";
  // pagination safe sorts
  const paginationSafe = ["new", "top", "hot"];

if (!paginationSafe.includes(sortEndpoint)) {
  sortEndpoint = "new";
}

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

      const data = await res.json();
      const children = data?.data?.children || [];
      if (children.length === 0) break;

      for (const child of children) {
        const p = child.data;
        if (p.stickied || p.over_18) continue;
        allPosts.push(buildPost(p));
        if (allPosts.length >= maxPosts) break;
      }

      lastAfter = data?.data?.after || null;
      after = lastAfter;
      if (!after) break;

    } catch (e) {
      console.error("Fetch error:", e.message);
      break;
    }
  }

  return { posts: allPosts, nextCursor: lastAfter }; // ← CHANGED
}

function buildPost(p) {
  return {
    id: p.id || "",
    title: p.title || "",
    author: p.author || "[deleted]",
    score: p.score || 0,
    upvote_ratio: p.upvote_ratio || 0,
    num_comments: p.num_comments || 0,
    created_utc: new Date((p.created_utc || 0) * 1000).toISOString(),
    url: p.url || "",
    permalink: p.permalink || "",
    selftext: p.selftext || "",
    is_self: p.is_self || false,
    flair: p.link_flair_text || "N/A",
    domain: p.domain || "reddit.com",
    thumbnail: p.thumbnail || "",
    awards: p.total_awards_received || 0
  };
}

async function getComments(permalink, limit) {
  try {
    const res = await fetch(
      `https://www.reddit.com${permalink}.json?limit=500&raw_json=1`,
      { headers: { "User-Agent": "RedditScraper/1.0 (Cloudflare Worker)" } }
    );

    if (!res.ok) return [];

    const data = await res.json();
    const commentsData = data[1]?.data?.children || [];
    const comments = [];

    function extract(list, depth) {
      if (comments.length >= limit) return;
      for (const child of list) {
        if (child.kind !== "t1") continue;
        const c = child.data;
        const body = c.body || "";
        if (!body || body === "[deleted]" || body === "[removed]") continue;

        comments.push({
          id: c.id || "",
          author: c.author || "[deleted]",
          text: body,
          score: c.score || 0,
          created_utc: new Date((c.created_utc || 0) * 1000).toISOString(),
          depth,
          parent_id: c.parent_id || "",
          is_submitter: c.is_submitter || false,
          awards: c.total_awards_received || 0
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
