// Cloudflare Worker - Reddit Scraper with Sorting & Date Filtering
// Supports: hot, new, top, rising, best

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Main scraping endpoint
    if (request.method === "POST" && url.pathname === "/scrape") {
      try {
        const body = await request.json();
        const subreddit = body.subreddit || "Overwatch";
        const limit = Math.min(100, body.limit || 25);
        const commentsPerPost = Math.min(50, body.commentsPerPost || 20);
        const startDate = body.startDate || null;
        const endDate = body.endDate || null;
        const sortBy = body.sortBy || "new";  // hot, new, top, rising, best
        const timeFilter = body.timeFilter || "all";  // hour, day, week, month, year, all (for 'top')

        const result = await scrapeRedditWithFilters(
          subreddit, 
          limit, 
          commentsPerPost,
          startDate,
          endDate,
          sortBy,
          timeFilter
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

    // Default response
    return new Response("Reddit Scraper API - POST to /scrape\nSupports: hot, new, top, rising, best + date filtering", {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};

// Main scraping function with filters
async function scrapeRedditWithFilters(subreddit, limit, commentsPerPost, startDate, endDate, sortBy, timeFilter) {
  const posts = [];
  const allComments = [];
  const dailyStats = {};
  
  // Parse dates
  let startDateTime = startDate ? new Date(startDate + "T00:00:00Z") : null;
  let endDateTime = endDate ? new Date(endDate + "T23:59:59Z") : null;
  
  // Get posts with sorting
  const maxPostsToCheck = limit * 3;
  const allPosts = await getPostsWithSort(subreddit, maxPostsToCheck, sortBy, timeFilter);
  
  // Filter posts by date if dates are provided
  const filteredPosts = [];
  for (const post of allPosts) {
    const postDate = new Date(post.created_utc);
    
    // Check date range (only if dates are provided)
    if (startDateTime && postDate < startDateTime) continue;
    if (endDateTime && postDate > endDateTime) continue;
    
    filteredPosts.push(post);
    
    // Track daily stats
    const dateKey = post.created_utc.split('T')[0];
    if (!dailyStats[dateKey]) {
      dailyStats[dateKey] = 0;
    }
    dailyStats[dateKey]++;
    
    // Stop if we have enough
    if (filteredPosts.length >= limit) break;
  }
  
  // Get comments for filtered posts
  for (const post of filteredPosts) {
    posts.push(post);
    
    const comments = await getComments(post.permalink, commentsPerPost);
    
    // Add post info to comments
    for (const comment of comments) {
      comment.post_title = post.title;
      comment.post_url = post.url;
      comment.post_id = post.id;
      comment.post_date = post.created_utc.split('T')[0];
    }
    
    allComments.push(...comments);
  }
  
  return {
    posts: posts,
    comments: allComments,
    dailyStats: dailyStats,
    stats: {
      totalPosts: posts.length,
      totalComments: allComments.length,
      sortBy: sortBy,
      timeFilter: timeFilter,
      dateRange: {
        start: startDate || "No limit",
        end: endDate || "No limit"
      },
      scrapedAt: new Date().toISOString()
    }
  };
}

// Get posts with sorting option
async function getPostsWithSort(subreddit, maxPosts, sortBy, timeFilter) {
  const allPosts = [];
  let after = null;
  
  // Map sorting options to Reddit endpoints
  const sortMap = {
    'hot': 'hot',
    'new': 'new',
    'top': 'top',
    'rising': 'rising',
    'best': 'best'
  };
  
  const sortEndpoint = sortMap[sortBy] || 'new';
  
  while (allPosts.length < maxPosts) {
    try {
      // Build URL based on sort type
      let url = `https://www.reddit.com/r/${subreddit}/${sortEndpoint}.json?limit=100`;
      
      // Add time filter for 'top' sort
      if (sortBy === 'top') {
        url += `&t=${timeFilter}`;
      }
      
      // Add pagination
      if (after) {
        url += `&after=${after}`;
      }
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) break;
      
      const data = await response.json();
      const children = data?.data?.children || [];
      
      if (children.length === 0) break;
      
      for (const child of children) {
        const p = child.data;
        
        // Skip stickied and NSFW posts
        if (p.stickied || p.over_18) continue;
        
        allPosts.push({
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
        });
        
        if (allPosts.length >= maxPosts) break;
      }
      
      // Get pagination token
      after = data?.data?.after;
      if (!after) break;
      
    } catch (e) {
      console.error('Fetch error:', e);
      break;
    }
  }
  
  return allPosts;
}

// Get comments for a post
async function getComments(permalink, limit) {
  try {
    const response = await fetch(
      `https://www.reddit.com${permalink}.json?limit=500`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const commentsData = data[1]?.data?.children || [];
    
    const comments = [];
    
    function extractComments(commentsList, depth) {
      if (comments.length >= limit) return;
      
      for (const child of commentsList) {
        if (child.kind !== 't1') continue;
        
        const c = child.data;
        const body = c.body || "";
        
        if (!body || body === '[deleted]' || body === '[removed]') continue;
        
        comments.push({
          id: c.id || "",
          author: c.author || "[deleted]",
          text: body,
          score: c.score || 0,
          created_utc: new Date((c.created_utc || 0) * 1000).toISOString(),
          depth: depth,
          parent_id: c.parent_id || "",
          is_submitter: c.is_submitter || false,
          awards: c.total_awards_received || 0
        });
        
        // Get replies
        if (depth < 2 && comments.length < limit && c.replies && c.replies.data) {
          const replies = c.replies.data.children || [];
          extractComments(replies, depth + 1);
        }
      }
    }
    
    extractComments(commentsData, 0);
    return comments.slice(0, limit);
  } catch (e) {
    return [];
  }
}
