// Cloudflare Worker - Reddit Overwatch Posts + Comments Scraper
// No API keys needed! Uses public Reddit JSON endpoints

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // ===== GET POSTS + COMMENTS =====
    if (request.method === "POST" && path.endsWith("/scrape")) {
      try {
        const body = await request.json().catch(() => ({}));
        const subreddit = body.subreddit || "Overwatch";
        const limit = Math.min(50, body.limit || 10);
        const commentsPerPost = Math.min(50, body.commentsPerPost || 20);

        const result = await scrapeRedditWithComments(subreddit, limit, commentsPerPost);
        
        return jsonResponse(result);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // ===== DOWNLOAD CSV =====
    if (request.method === "POST" && path.endsWith("/download-csv")) {
      try {
        const body = await request.json().catch(() => ({}));
        const posts = body.posts || [];
        const comments = body.comments || [];
        
        // Generate CSVs
        const postsCSV = generatePostsCSV(posts);
        const commentsCSV = generateCommentsCSV(comments);
        
        return jsonResponse({
          postsCSV,
          commentsCSV
        });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // Default response
    return new Response("Overwatch Reddit Scraper API\n\nEndpoints:\nPOST /scrape - Get posts and comments\nPOST /download-csv - Convert to CSV", {
      headers: corsHeaders()
    });
  }
};

// ===== MAIN SCRAPING FUNCTION =====
async function scrapeRedditWithComments(subreddit, limit, commentsPerPost) {
  const posts = [];
  const allComments = [];
  
  // Try to get posts from Reddit JSON API
  let postLinks = await getPostsFromJSON(subreddit, limit);
  
  // If JSON fails, try RSS
  if (postLinks.length === 0) {
    postLinks = await getPostsFromRSS(subreddit, limit);
  }
  
  // If RSS fails, try old Reddit HTML
  if (postLinks.length === 0) {
    postLinks = await getPostsFromOldHTML(subreddit, limit);
  }
  
  console.log(`Found ${postLinks.length} posts`);
  
  // For each post, get comments
  for (const postData of postLinks) {
    posts.push(postData);
    
    // Get comments for this post
    const comments = await getCommentsForPost(postData.permalink, commentsPerPost);
    
    // Add post context to each comment
    comments.forEach(comment => {
      comment.post_title = postData.title;
      comment.post_url = postData.url;
      comment.post_id = postData.id;
    });
    
    allComments.push(...comments);
  }
  
  return {
    posts,
    comments: allComments,
    stats: {
      totalPosts: posts.length,
      totalComments: allComments.length,
      scrapedAt: new Date().toISOString()
    }
  };
}

// ===== GET POSTS FROM JSON =====
async function getPostsFromJSON(subreddit, limit) {
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
    
    for (const child of (data?.data?.children || [])) {
      const post = child.data;
      
      if (post.stickied || post.over_18) continue;
      
      posts.push({
        id: post.id,
        title: post.title || "",
        author: post.author || "[deleted]",
        score: post.score || 0,
        upvote_ratio: post.upvote_ratio || 0,
        num_comments: post.num_comments || 0,
        created_utc: new Date((post.created_utc || 0) * 1000).toISOString(),
        url: post.url || `https://www.reddit.com${post.permalink}`,
        permalink: post.permalink,
        selftext: post.selftext || "",
        is_self: post.is_self || false,
        flair: post.link_flair_text || "N/A",
        domain: post.domain || "reddit.com"
      });
    }
    
    return posts;
  } catch (e) {
    console.error('JSON fetch failed:', e);
    return [];
  }
}

// ===== GET POSTS FROM RSS =====
async function getPostsFromRSS(subreddit, limit) {
  try {
    const response = await fetch(
      `https://www.reddit.com/r/${subreddit}/.rss`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/rss+xml,text/xml'
        }
      }
    );
    
    if (!response.ok) return [];
    
    const xml = await response.text();
    const posts = [];
    
    const entryRe = /<entry>[\s\S]*?<\/entry>/gi;
    const titleRe = /<title>([\s\S]*?)<\/title>/i;
    const linkRe = /<link[^>]*href="([^"]+)"/i;
    const updatedRe = /<updated>([^<]+)<\/updated>/i;
    const authorRe = /<name>([^<]+)<\/name>/i;
    
    let match;
    while ((match = entryRe.exec(xml)) && posts.length < limit) {
      const block = match[0];
      const title = (titleRe.exec(block)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const url = linkRe.exec(block)?.[1] || "";
      const created = updatedRe.exec(block)?.[1] || new Date().toISOString();
      const author = authorRe.exec(block)?.[1] || "[deleted]";
      
      if (!title || !url) continue;
      
      // Extract permalink from URL
      const permalinkMatch = url.match(/\/r\/\w+\/comments\/[^/]+\/[^/]+\//);
      const permalink = permalinkMatch ? permalinkMatch[0] : "";
      
      posts.push({
        id: url.split('/comments/')[1]?.split('/')[0] || "",
        title,
        author: author.replace('/u/', ''),
        score: 0,
        upvote_ratio: 0,
        num_comments: 0,
        created_utc: new Date(created).toISOString(),
        url,
        permalink,
        selftext: "",
        is_self: false,
        flair: "N/A",
        domain: "reddit.com"
      });
    }
    
    return posts;
  } catch (e) {
    console.error('RSS fetch failed:', e);
    return [];
  }
}

// ===== GET POSTS FROM OLD HTML =====
async function getPostsFromOldHTML(subreddit, limit) {
  try {
    const response = await fetch(
      `https://old.reddit.com/r/${subreddit}/new/`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );
    
    if (!response.ok) return [];
    
    const html = await response.text();
    const posts = [];
    
    const linkRe = /<a[^>]*class="(?:title|may-blank)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    
    let match;
    while ((match = linkRe.exec(html)) && posts.length < limit) {
      const url = match[1];
      const title = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      
      if (!title || title.length < 10) continue;
      
      const permalinkMatch = url.match(/\/r\/\w+\/comments\/[^/]+\/[^/]+\//);
      const permalink = permalinkMatch ? permalinkMatch[0] : url;
      
      posts.push({
        id: url.split('/comments/')[1]?.split('/')[0] || "",
        title,
        author: "[unknown]",
        score: 0,
        upvote_ratio: 0,
        num_comments: 0,
        created_utc: new Date().toISOString(),
        url: url.startsWith('http') ? url : `https://old.reddit.com${url}`,
        permalink,
        selftext: "",
        is_self: false,
        flair: "N/A",
        domain: "reddit.com"
      });
    }
    
    return posts;
  } catch (e) {
    console.error('Old HTML fetch failed:', e);
    return [];
  }
}

// ===== GET COMMENTS FOR A POST =====
async function getCommentsForPost(permalink, limit) {
  try {
    // Use Reddit JSON API for comments
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
    
    // Comments are in the second element of the array
    const commentsData = data[1]?.data?.children || [];
    
    const comments = [];
    
    function extractComments(commentsList, depth = 0) {
      if (comments.length >= limit) return;
      
      for (const child of commentsList) {
        if (child.kind !== 't1') continue; // t1 = comment
        
        const comment = child.data;
        
        // Skip deleted comments
        if (!comment.body || comment.body === '[deleted]' || comment.body === '[removed]') continue;
        
        comments.push({
          id: comment.id,
          author: comment.author || "[deleted]",
          text: comment.body,
          score: comment.score || 0,
          created_utc: new Date((comment.created_utc || 0) * 1000).toISOString(),
          depth: depth,
          parent_id: comment.parent_id || "",
          is_submitter: comment.is_submitter || false
        });
        
        // Recursively get replies (up to depth 2 to avoid too much data)
        if (comment.replies && depth < 2 && comments.length < limit) {
          const replies = comment.replies?.data?.children || [];
          extractComments(replies, depth + 1);
        }
      }
    }
    
    extractComments(commentsData);
    
    return comments.slice(0, limit);
  } catch (e) {
    console.error('Comments fetch failed:', e);
    return [];
  }
}

// ===== CSV GENERATION =====
function generatePostsCSV(posts) {
  if (!posts || posts.length === 0) return "";
  
  const headers = ["id", "title", "author", "score", "upvote_ratio", "num_comments", "created_utc", "url", "permalink", "selftext", "is_self", "flair", "domain"];
  
  let csv = headers.join(",") + "\n";
  
  for (const post of posts) {
    const row = headers.map(header => {
      const value = post[header] || "";
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csv += row.join(",") + "\n";
  }
  
  return csv;
}

function generateCommentsCSV(comments) {
  if (!comments || comments.length === 0) return "";
  
  const headers = ["id", "post_title", "post_url", "post_id", "author", "text", "score", "created_utc", "depth", "parent_id", "is_submitter"];
  
  let csv = headers.join(",") + "\n";
  
  for (const comment of comments) {
    const row = headers.map(header => {
      const value = comment[header] || "";
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csv += row.join(",") + "\n";
  }
  
  return csv;
}

// ===== HELPER FUNCTIONS =====
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json"
    }
  });
}
