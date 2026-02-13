// Cloudflare Worker - Reddit Scraper (Simplified & Tested)
// Scrapes posts and comments from Reddit without API keys

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
        const limit = Math.min(25, body.limit || 10);
        const commentsPerPost = Math.min(30, body.commentsPerPost || 20);

        const result = await scrapeReddit(subreddit, limit, commentsPerPost);
        
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
    return new Response("Reddit Scraper API - POST to /scrape", {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};

// Main scraping function
async function scrapeReddit(subreddit, limit, commentsPerPost) {
  const posts = [];
  const allComments = [];
  
  // Get posts
  const postsList = await getPosts(subreddit, limit);
  
  // Get comments for each post
  for (const post of postsList) {
    posts.push(post);
    
    const comments = await getComments(post.permalink, commentsPerPost);
    
    // Add post info to comments
    for (const comment of comments) {
      comment.post_title = post.title;
      comment.post_url = post.url;
      comment.post_id = post.id;
    }
    
    allComments.push(...comments);
  }
  
  return {
    posts: posts,
    comments: allComments,
    stats: {
      totalPosts: posts.length,
      totalComments: allComments.length,
      scrapedAt: new Date().toISOString()
    }
  };
}

// Get posts from Reddit
async function getPosts(subreddit, limit) {
  try {
    const response = await fetch(
      `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const posts = [];
    
    const children = data?.data?.children || [];
    
    for (const child of children) {
      const p = child.data;
      
      if (p.stickied || p.over_18) continue;
      
      posts.push({
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
        domain: p.domain || "reddit.com"
      });
    }
    
    return posts;
  } catch (e) {
    return [];
  }
}

// Get comments for a post
async function getComments(permalink, limit) {
  try {
    const response = await fetch(
      `https://www.reddit.com${permalink}.json`,
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
          is_submitter: c.is_submitter || false
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
