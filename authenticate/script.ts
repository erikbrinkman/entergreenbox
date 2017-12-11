(async function() {
  const resp: {[key: string]: string} = {};
  location.hash.slice(1).split("&").forEach(kv => {
    const [key, val] = kv.split("=");
    resp[key] = decodeURIComponent(val);
  });
  try {
    if (resp.access_token !== undefined) {
      opener.authenticate(resp.state, resp.access_token, resp.expires_in === undefined ? undefined : parseInt(resp.expires_in));
      close();
    } else {
      const error: {[key: string]: string} = {};
      location.search.slice(1).split("&").forEach(kv => {
        const [key, val] = kv.split("=");
        error[key] = decodeURIComponent(val);
      });
      opener.app.spotifyAuthenticate(error.state, undefined, undefined, error.error);
      close();
    }
  } catch (err) {
    // FIXME Notify user
    throw err;
  }
})();
