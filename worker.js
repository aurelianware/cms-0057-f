export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "cms0057f.com" || url.hostname === "www.cms0057f.com") {
      url.hostname = "cms-0057-f.com";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
