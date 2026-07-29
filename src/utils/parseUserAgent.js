// Minimal User-Agent parsing for session display purposes only (e.g. "iPhone
// - Safari"). Not meant to be exhaustive — good enough to tell a student
// which of their devices is which when picking one to log out.
function parseDevice(ua = "") {
  if (/ipad/i.test(ua)) return "iPad";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/macintosh|mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows PC";
  if (/linux/i.test(ua)) return "Linux PC";
  return "Unknown device";
}

function parseBrowser(ua = "") {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return "Chrome";
  if (/crios\//i.test(ua)) return "Chrome (iOS)";
  if (/fxios\//i.test(ua)) return "Firefox (iOS)";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/safari\//i.test(ua) && !/chrome\/|crios\//i.test(ua)) return "Safari";
  return "Unknown browser";
}

function parseUserAgent(ua = "") {
  return { device: parseDevice(ua), browser: parseBrowser(ua) };
}

module.exports = parseUserAgent;
