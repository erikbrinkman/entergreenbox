"use strict";
(async () => {
    // --------
    // Elements
    // --------
    const toastElem = document.getElementById("toast");
    const addall = document.getElementById("addall");
    const download = document.getElementById("download");
    const spotify = document.getElementById("spotify");
    const spotifyIcon = spotify.querySelector("i");
    const spotifyImg = spotify.querySelector("img");
    const spotifyTooltip = document.getElementById("spotify-tooltip");
    const main = document.getElementsByTagName("main")[0];
    const itemList = document.getElementById("item-list");
    const playlists = [];
    const albums = [];
    const items = () => [].concat(playlists, albums);
    // -----
    // Toast
    // -----
    let toastUpgraded = false;
    const pendingToasts = [];
    /** Trigger a toast with message */
    function toast(message) {
        if (toastUpgraded) {
            toastElem.MaterialSnackbar.showSnackbar({ message: message });
        }
        else {
            pendingToasts.push(message);
        }
    }
    toastElem.addEventListener("mdl-componentupgraded", () => {
        toastUpgraded = true;
        pendingToasts.forEach(toast);
        pendingToasts.length = 0;
    });
    // -----
    // Utils
    // -----
    /** Chunk array into smaller arrays no larger than chunkSize */
    function chunk(arr, chunkSize) {
        return Array(Math.ceil(arr.length / chunkSize)).fill(undefined)
            .map((_, i) => arr.slice(i * chunkSize, (i + 1) * chunkSize));
    }
    /** Get a url with given queries, but does not escape them. */
    function queryurl(base, options) {
        return base + "?" + Object.entries(options).map(([key, val]) => `${key}=${val}`).join("&");
    }
    /** Compute the levenshtein table and distance from two array-likes
     *
     * @param init the starting string
     * @param fin the final string
     * @param ins function that computes the cost of inserting an element from the final string
     * @param del function that computes the cost of deleting an element from the initial string
     * @param sub function that computes the cost of substituting an element from the initial string to the final string
     */
    function levenshtein(init, fin, { ins = () => 1, del = () => 1, sub = (i, j) => i === j ? 0 : 1 }) {
        const arri = Array.from(init);
        const arrf = Array.from(fin);
        const first = [0];
        arrf.reduce((last, fe) => {
            const next = last + ins(fe);
            first.push(next);
            return next;
        }, 0);
        const dists = [first];
        arri.forEach((ie, i) => {
            const next = [dists[i][0] + del(ie)];
            dists.push(next);
            arrf.forEach((fe, f) => {
                next.push(Math.min(dists[i][f + 1] + del(ie), dists[i + 1][f] + ins(fe), dists[i][f] + sub(ie, fe)));
            });
        });
        return dists;
    }
    /** Given a desired array and it's current state, return the indices to
     * insert elements into existing to make it as close as possible to desired
     */
    function alignArrays(desired, existing) {
        // This prevents floating point rounding
        const ins = Math.pow(2, Math.floor(Math.log2(1 / existing.length)));
        const sub = Math.max(desired.length, existing.length);
        const lev = levenshtein(desired, existing, {
            ins: () => ins,
            sub: (a, b) => {
                if (a === b) {
                    return 0;
                    /* TODO Ideally this make it preferential to substitute a non matched
                     * song to one we would delete, but it also seems to make it miss
                     * substitutions because it can match a deletion for the same cost.
                     * Maybe instead of 1, it should be 1 + 1 / length ** 2, but that will
                     * have numeric issues, so maybe multiply all costs by length?
                    } else if (b === null) {
                      return 1;
                    */
                }
                else {
                    return sub;
                }
            },
        });
        let e = existing.length;
        let d = desired.length;
        const result = [];
        const insert = [];
        while (d > 0) {
            if (e === 0) {
                const id = desired[--d];
                if (id !== null) {
                    insert.push(id);
                }
            }
            else {
                const min = Math.min(lev[d - 1][e], lev[d][e - 1], lev[d - 1][e - 1]);
                if (min === lev[d][e - 1]) {
                    if (insert.length > 0) {
                        result.push({ pos: e, elements: insert.splice(0).reverse() });
                    }
                    --e;
                }
                else if (min === lev[d - 1][e - 1]) {
                    if (insert.length > 0) {
                        result.push({ pos: e, elements: insert.splice(0).reverse() });
                    }
                    --d;
                    --e;
                }
                else {
                    const id = desired[--d];
                    if (id !== null) {
                        insert.push(id);
                    }
                }
            }
        }
        if (insert.length > 0) {
            result.push({ pos: e, elements: insert.reverse() });
        }
        return result;
    }
    /** Remove null and undefineds from an array */
    function filterMissing(input) {
        return input.reduce((arr, elem) => {
            if (elem !== undefined && elem !== null) {
                arr.push(elem);
            }
            return arr;
        }, []);
    }
    /** Given an asynchronous batch function, create an efficient version of single queries */
    function unbatch(batchFunction, maxSize, timeout) {
        const callbacks = [];
        let timeoutHandle = undefined;
        async function single(input) {
            return await new Promise((resolve, reject) => {
                callbacks.push([input, resolve, reject]);
                if (callbacks.length >= maxSize) {
                    finish();
                }
                else if (timeoutHandle === undefined) {
                    timeoutHandle = setTimeout(finish, timeout);
                }
            });
        }
        async function finish() {
            const data = callbacks.splice(0);
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
                timeoutHandle = undefined;
            }
            if (data.length > 0) {
                try {
                    const results = await batchFunction(data.map(([input]) => input));
                    data.forEach(([, res], i) => res(results[i]));
                }
                catch (err) {
                    data.forEach(([, , rej]) => rej(err));
                }
            }
        }
        return single;
    }
    // ----------------------
    // Spotify Authentication
    // ----------------------
    let access = undefined;
    let autoLogout = undefined;
    /** Alert if we get authentication called when we don't expect it */
    function earlyAuthentication() {
        toast("Authentication called before expected");
    }
    window.authenticate = earlyAuthentication;
    /** Get an authentication token from Spotify */
    async function spotifyGetToken() {
        const randArray = new Uint8Array(8);
        crypto.getRandomValues(randArray);
        const state = btoa(String.fromCharCode(...randArray));
        const redirect = [location.protocol, "//", location.host,
            location.pathname, "authenticate"].join("");
        const url = queryurl("https://accounts.spotify.com/authorize", {
            client_id: "2005e5addadd4bb38165e6b716d7c700",
            response_type: "token",
            redirect_uri: encodeURIComponent(redirect),
            state: encodeURIComponent(state),
            scope: "user-read-private user-library-read user-library-modify playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative",
        });
        try {
            const token = await new Promise((resolve, reject) => {
                window.authenticate = (respState, access, expire, err) => {
                    if (respState !== state) {
                        reject("Authentication failed with improper state");
                    }
                    else if (err !== undefined) {
                        reject(err);
                    }
                    else if (access === undefined || expire === undefined) {
                        reject("Missing authentication information");
                    }
                    else {
                        autoLogout = setTimeout(spotifyLogout, expire * 1000);
                        const date = new Date();
                        date.setSeconds(date.getSeconds() + expire);
                        localStorage.expire = date;
                        resolve(access);
                    }
                };
                const oauth = open(url, "Spotify Authentication", "toolbar=0,menubar=0");
                if (oauth === null) {
                    reject("Failed to open authentication popup. This could indicate a popup blocker.");
                }
                else {
                    oauth.focus();
                    oauth.addEventListener("beforeunload", () => reject("Window closed without authenticating"));
                }
            });
            // Mock access to do the profile request
            access = { token: token, id: "", name: "" };
            const resp = await request("GET", "https://api.spotify.com/v1/me");
            const profile = await resp.json();
            access = {
                token: token,
                id: profile.id,
                name: profile.display_name || profile.id,
                img: profile.images.length > 0 ? profile.images[0].url : undefined,
            };
            await spotifyLogin();
            matchAndCheckLibrary();
        }
        catch (err) {
            toast(err);
            spotifyLogout();
            throw err;
        }
        finally {
            window.authenticate = earlyAuthentication;
        }
    }
    /** Update state with a logged in status */
    async function spotifyLogin() {
        if (access === undefined) {
            spotifyLogout();
        }
        else {
            spotify.removeEventListener("click", spotifyGetToken);
            spotify.setAttribute("disabled", "");
            spotifyIcon.textContent = "person";
            spotifyTooltip.textContent = "Sign out of Spotify";
            toast(`Logged in as ${access.name}`);
            if (access.img !== undefined) {
                spotifyIcon.style.display = "none";
                spotifyImg.setAttribute("src", access.img);
                spotifyImg.style.display = "block";
            }
            spotify.addEventListener("click", spotifyLogout);
            spotify.removeAttribute("disabled");
            items().forEach(a => a.update());
        }
    }
    /** Update state with a logged out status */
    function spotifyLogout() {
        spotify.removeEventListener("click", spotifyLogout);
        spotify.setAttribute("disabled", "");
        if (autoLogout !== undefined) {
            clearTimeout(autoLogout);
        }
        if (access !== undefined) {
            toast("Logged out");
        }
        spotifyIcon.textContent = "person_outline";
        spotifyImg.style.display = "none";
        spotifyIcon.style.display = "inline-block";
        spotifyTooltip.textContent = "Sign in to Spotify";
        access = undefined;
        spotify.addEventListener("click", spotifyGetToken);
        spotify.removeAttribute("disabled");
        resetFoundPlaylists();
        disableAddAll();
        items().forEach(i => i.update());
    }
    let requestRunning = false;
    const requestQueue = [];
    /** Send a request with Spotify authentication headers and appropriate retries */
    async function request(method, url, body) {
        if (requestRunning) {
            await new Promise(resolve => requestQueue.push(resolve));
        }
        if (access === undefined) {
            requestQueue.forEach(r => r());
            throw "Unauthorized";
        }
        requestRunning = true;
        let resp = undefined;
        let timeout = 2000;
        // Begin request
        while (resp === undefined) {
            resp = await fetch(url, {
                method: method,
                headers: {
                    Authorization: "Bearer " + access.token,
                    "Content-Type": "application/json",
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            if (resp.status === 429) {
                // XXX Retry-After header is not available due to cors so we just increment timeout
                console.error("Faked Retry-After", timeout);
                await new Promise(resolve => setTimeout(resolve, timeout));
                timeout *= 2;
                resp = undefined;
            }
            else if (resp.status >= 500 && resp.status < 600) {
                // TODO If we get enough in a row, we should fail...
                await new Promise(resolve => setTimeout(resolve, 5000));
                resp = undefined;
            }
        }
        requestRunning = false;
        const next = requestQueue.pop();
        if (next !== undefined) {
            next();
        }
        if (!resp.ok) {
            if (access !== undefined) {
                spotifyLogout();
            }
            throw resp.statusText;
        }
        else {
            return resp;
        }
    }
    /** Given a pager, fetch all of the items */
    async function fetchPager(pager) {
        const items = pager.items;
        while (pager.next !== null) {
            const resp = await request("GET", pager.next);
            pager = await resp.json();
            pager.items.forEach(item => items.push(item));
        }
        return items;
    }
    /** Get an album from an id, batched to make queries more efficient */
    async function fetchAlbums(ids) {
        const resp = await request("GET", queryurl("https://api.spotify.com/v1/albums", {
            ids: ids.join(","),
            market: "from_token",
        }));
        const { albums } = await resp.json();
        return albums;
    }
    const fetchAlbum = unbatch(fetchAlbums, 20, 2000);
    /** Check if an album is in a users library, batched to be more efficient */
    async function albumsInLibrary(ids) {
        const resp = await request("GET", queryurl("https://api.spotify.com/v1/me/albums/contains", {
            ids: ids.join(","),
        }));
        return await resp.json();
    }
    const albumInLibrary = unbatch(albumsInLibrary, 50, 10);
    /** Add albums to a users library, batched to be more efficient */
    async function addAlbums(ids) {
        await request("PUT", "https://api.spotify.com/v1/me/albums", ids);
        return ids.map(() => undefined);
    }
    const addAlbum = unbatch(addAlbums, 50, 10);
    /** Add tracks in positions to a specific playlist
     *
     * @param trackPostions, the positions for insert must be in reverse order
     */
    async function addTracksToPlaylist(playlist, trackPositions) {
        for (const { pos, ids } of trackPositions) {
            for (const tracks of chunk(ids.map(id => `spotify:track:${id}`), 100).reverse()) {
                await request("POST", `https://api.spotify.com/v1/users/${playlist.owner.id}/playlists/${playlist.id}/tracks`, {
                    uris: tracks,
                    position: pos,
                });
            }
        }
    }
    /** Find a track on spotify given out track representation */
    async function findTrack(track) {
        let query = `track:"${encodeURIComponent(track.title)}"`;
        if (track.artists.length > 0) {
            query += `%20artist:"${encodeURIComponent(track.artists.map(a => a.name).join(" "))}"`;
        }
        const resp = await request("GET", queryurl("https://api.spotify.com/v1/search", {
            q: query,
            type: "track",
            market: "from_token",
        }));
        const { tracks } = await resp.json();
        if (tracks.items.length === 0) {
            return undefined;
        }
        else {
            return tracks.items[0];
        }
    }
    /** Find album on spotify given out representation */
    async function findAlbum(album) {
        let query = `album:"${encodeURIComponent(album.name)}"`;
        if (album.artists.length > 0) {
            query += `%20artist:"${encodeURIComponent(album.artists.map(a => a.name).join(" "))}"`;
        }
        const resp = await request("GET", queryurl("https://api.spotify.com/v1/search", {
            q: query,
            type: "album",
            market: "from_token",
        }));
        const { albums } = await resp.json();
        if (albums.items.length === 0) {
            return undefined;
        }
        else {
            return albums.items[0];
        }
    }
    let findingPlaylistsFlag = false;
    let foundPlaylistsFlag = false;
    const findingPlaylistsCallbacks = [];
    let foundPlaylists = {};
    /** Find a playlist given our representation */
    async function findPlaylist(play) {
        if (!findingPlaylistsFlag) {
            findingPlaylistsFlag = true;
            foundPlaylists = {};
            const resp = await request("GET", queryurl("https://api.spotify.com/v1/me/playlists", { limit: "50" }));
            const pager = await resp.json();
            const plays = await fetchPager(pager);
            for (const p of plays) {
                (foundPlaylists[p.name] || (foundPlaylists[p.name] = [])).push(p);
            }
            foundPlaylistsFlag = true;
            findingPlaylistsCallbacks.forEach(res => res());
            findingPlaylistsCallbacks.length = 0;
        }
        else if (!foundPlaylistsFlag) {
            await new Promise(resolve => findingPlaylistsCallbacks.push(resolve));
        }
        const matches = foundPlaylists[play.name];
        if (matches === undefined) {
            // tslint:disable-next-line:no-null-keyword
            return null;
        }
        else if (matches.length === 1) {
            return matches[0];
        }
        else {
            toast(`Found ${matches.length} playlists named ${play.name}`);
            // tslint:disable-next-line:no-null-keyword
            return null;
        }
    }
    function resetFoundPlaylists() {
        findingPlaylistsFlag = foundPlaylistsFlag = false;
    }
    /** Save state when closed */
    addEventListener("unload", () => {
        if (access !== undefined) {
            localStorage.access = JSON.stringify(access);
        }
        else {
            localStorage.removeItem("access");
        }
        localStorage.playlists = JSON.stringify(playlists.map(item => item.data));
        localStorage.albums = JSON.stringify(albums.map(item => item.data));
    });
    /** Attempt to login with saved credentials */
    (async () => {
        if (localStorage.access === undefined || localStorage.expire === undefined) {
            spotifyLogout();
        }
        else {
            const expire = new Date(localStorage.expire).getTime() - new Date().getTime();
            if (expire <= 0) {
                spotifyLogout();
            }
            else {
                access = JSON.parse(localStorage.access);
                autoLogout = setTimeout(spotifyLogout, expire);
                spotifyLogin();
            }
        }
    })();
    // -----------
    // Top Buttons
    // -----------
    /** Enable add all button */
    function enableAddAll() {
        addall.addEventListener("click", addAll);
        addall.removeAttribute("disabled");
    }
    /** Disable add all button */
    function disableAddAll() {
        addall.removeEventListener("click", addAll);
        addall.setAttribute("disabled", "");
    }
    /** Add all items to library */
    async function addAll() {
        try {
            disableAddAll();
            await Promise.all(items().reverse().map(i => i.click()));
        }
        catch (err) {
            toast(err);
        }
    }
    /** Enable download */
    download.addEventListener("click", () => {
        const blob = new Blob([JSON.stringify({
                playlists: playlists.map(p => p.data),
                albums: albums.map(a => a.data),
            })], { type: "text/plain;charset=utf-8" });
        saveAs(blob, "library.json");
    });
    download.removeAttribute("disabled");
    // -----
    // Items
    // -----
    /** Convert a Spotify track into our track representation */
    class STrack {
        constructor({ artists, duration_ms, id, name, track_number, explicit }) {
            this.artists = artists.map(({ name }) => ({ name: name }));
            this.duration_ms = duration_ms;
            this.ids = { spotify: id };
            this.title = name;
            this.track = track_number;
            this.explicit = explicit;
            this.matched = true;
            this.type = "track";
        }
    }
    /** Generic music item to sync between our representation and Spotify */
    class MusicItem {
        constructor(data) {
            this.data = data;
            this.element = document.createElement("li");
            this.element.classList.add("mdl-list__item");
            this.element.classList.add("mdl-list__item--two-line");
            const primary = document.createElement("span");
            primary.classList.add("mdl-list__item-primary-content");
            this.element.appendChild(primary);
            this.avatar = document.createElement("i");
            this.avatar.classList.add("material-icons");
            this.avatar.classList.add("mdl-list__item-avatar");
            primary.appendChild(this.avatar);
            this.img = document.createElement("img");
            this.img.classList.add("mdl-list__item-avatar");
            this.img.style.display = "none";
            primary.appendChild(this.img);
            this.header = document.createElement("span");
            primary.appendChild(this.header);
            this.subheader = document.createElement("span");
            this.subheader.classList.add("mdl-list__item-sub-title");
            primary.appendChild(this.subheader);
            const secondary = document.createElement("span");
            secondary.classList.add("mdl-list__item-secondary-content");
            this.element.appendChild(secondary);
            this.button = document.createElement("button");
            this.button.classList.add("mdl-list__item-secondary-action");
            this.button.classList.add("mdl-button");
            this.button.classList.add("mdl-js-button");
            this.button.classList.add("mdl-js-ripple-effect");
            this.button.setAttribute("disabled", "");
            secondary.appendChild(this.button);
            this.update();
        }
        /** The handle to use for click events so errors are toasted */
        async clickHandle() {
            try {
                await this.click();
            }
            catch (err) {
                toast(err);
            }
        }
    }
    /** Represents a playlist */
    class PlaylistItem extends MusicItem {
        constructor(play) {
            super(play);
            this.insertions = [];
            this.avatar.textContent = "playlist_play";
            this.header.textContent = this.data.name;
            this.subheader.textContent = this.data.description;
        }
        update() {
            if (access !== undefined && this.clickable()) {
                if (this.match === null) {
                    this.button.textContent = "Create Playlist";
                }
                else {
                    this.button.textContent = "Update Playlist";
                }
                this.button.addEventListener("click", () => this.clickHandle());
                this.button.removeAttribute("disabled");
            }
            else {
                if (access !== undefined && this.match !== undefined) {
                    this.button.textContent = "In Library";
                }
                else if (!this.data.tracks.every(({ ids }) => ids.spotify !== undefined)) {
                    this.button.textContent = "Unknown";
                }
                else {
                    // We know matched is not undefined
                    const matched = this.data.tracks.reduce((s, { ids }) => s + (+(ids.spotify !== null)), 0);
                    this.button.textContent = `Matched ${matched} of ${this.data.tracks.length} Tracks`;
                }
                this.button.removeEventListener("click", () => this.clickHandle());
                this.button.setAttribute("disabled", "");
            }
        }
        async sync() {
            if (access !== undefined && this.data.tracks.some(({ ids }) => ids.spotify === undefined)) {
                try {
                    this.button.textContent = "Matching...";
                    this.data.tracks = await Promise.all(this.data.tracks.map(async (track) => {
                        if (track.ids.spotify === undefined) {
                            const match = await findTrack(track);
                            if (match === undefined) {
                                // tslint:disable-next-line:no-null-keyword
                                track.ids.spotify = null;
                                return track;
                            }
                            else {
                                return new STrack(match);
                            }
                        }
                        else {
                            return track;
                        }
                    }));
                }
                finally {
                    this.update();
                }
            }
        }
        async find() {
            if (access !== undefined) {
                try {
                    this.button.textContent = "Finding...";
                    this.match = await findPlaylist(this.data);
                    if (this.match === null) {
                        this.insertions = [{ pos: 0, ids: filterMissing(this.data.tracks.map(({ ids }) => ids.spotify)) }];
                    }
                    else {
                        const resp = await request("GET", this.match.tracks.href);
                        const pager = await resp.json();
                        const tracks = await fetchPager(pager);
                        // tslint:disable-next-line:no-null-keyword
                        const matchIds = tracks.map(({ is_local, track }) => is_local ? null : track.id);
                        const dataIds = this.data.tracks.map(({ ids }) => ids.spotify);
                        this.insertions = alignArrays(dataIds, matchIds).map(({ pos, elements }) => ({ pos: pos, ids: elements }));
                    }
                }
                finally {
                    this.update();
                }
            }
        }
        clickable() {
            return this.match === null || (this.match !== undefined && this.insertions.length > 0);
        }
        async click() {
            if (access !== undefined && this.clickable()) {
                try {
                    this.button.setAttribute("disabled", "");
                    this.button.textContent = "Adding...";
                    if (this.match === null) {
                        const resp = await request("POST", `https://api.spotify.com/v1/users/${access.id}/playlists`, {
                            name: this.data.name,
                            public: false,
                            description: this.data.description,
                        });
                        this.match = await resp.json();
                    }
                    if (this.match !== undefined && this.insertions.length > 0) {
                        await addTracksToPlaylist(this.match, this.insertions);
                    }
                    this.insertions.length = 0;
                }
                finally {
                    this.update();
                }
            }
        }
    }
    /** Represents an album */
    class AlbumItem extends MusicItem {
        constructor(album) {
            super(album);
            this.tracksInLib = [];
            this.avatar.textContent = "album";
        }
        update() {
            if (this.data.art !== null) {
                this.img.setAttribute("src", this.data.art.replace(/^http:\/\//, "https://"));
                this.avatar.style.display = "none";
                this.img.style.display = "initial";
            }
            else {
                this.img.style.display = "none";
                this.avatar.style.display = "initial";
            }
            this.header.textContent = this.data.name;
            this.subheader.textContent = this.data.artists.map(a => a.name).join(", ");
            if (access !== undefined && this.clickable()) {
                this.button.textContent = "Add to Library";
                this.button.addEventListener("click", () => this.clickHandle());
                this.button.removeAttribute("disabled");
            }
            else {
                this.button.removeEventListener("click", () => this.clickHandle());
                this.button.setAttribute("disabled", "");
                if (access !== undefined && this.inLibrary) {
                    this.button.textContent = "In Library";
                }
                else if (this.data.ids.spotify === undefined) {
                    this.button.textContent = "Unknown";
                }
                else if (this.data.ids.spotify !== null) {
                    this.button.textContent = "Matched";
                }
                else {
                    this.button.textContent = "Unmatched";
                }
            }
        }
        async sync() {
            if (access !== undefined && this.data.ids.spotify === undefined) {
                try {
                    this.button.textContent = "Matching...";
                    const album = await findAlbum(this.data);
                    if (album !== undefined) {
                        await this.updateData(album);
                    }
                    else {
                        // Try to find album by indexing tracks
                        const tracks = await Promise.all(this.data.tracks.map(async (track) => await findTrack(track)));
                        const found = filterMissing(tracks);
                        if (found.length === 0) {
                            // tslint:disable-next-line:no-null-keyword
                            this.data.ids.spotify = null;
                        }
                        else {
                            const counts = found.reduce((cnt, { album }) => {
                                cnt[album.id] = (cnt[album.id] || 0) + 1;
                                return cnt;
                            }, {});
                            const maxAmount = Math.max(...Object.keys(counts).map(k => counts[k]));
                            if (maxAmount > found.length / 2) {
                                const id = Object.keys(counts).filter(k => counts[k] == maxAmount)[0];
                                await this.updateData({ id: id });
                            }
                            else {
                                // tslint:disable-next-line:no-null-keyword
                                this.data.ids.spotify = null;
                            }
                        }
                    }
                }
                finally {
                    this.update();
                }
            }
        }
        /** Update internal data with album id */
        async updateData({ id }) {
            const album = await fetchAlbum(id);
            const stracks = await fetchPager(album.tracks);
            if (album.images.length > 0) {
                const minSize = Math.min(...album.images.map(({ width, height }) => width * height));
                this.data.art = album.images.filter(({ width, height }) => minSize === width * height)[0].url;
            }
            this.data.artists = album.artists.map(({ name }) => ({ name: name }));
            this.data.ids.spotify = album.id;
            this.data.name = album.name;
            this.data.num_tracks = stracks.length;
            this.data.tracks = stracks.map(t => new STrack(t));
        }
        async find() {
            if (this.data.ids.spotify) {
                try {
                    this.button.textContent = "Finding...";
                    this.inLibrary = await albumInLibrary(this.data.ids.spotify);
                }
                finally {
                    this.update();
                }
            }
        }
        clickable() {
            return this.inLibrary === false && this.data.ids.spotify !== undefined && this.data.ids.spotify !== null;
        }
        async click() {
            if (access !== undefined && this.clickable() && this.data.ids.spotify) {
                try {
                    this.button.setAttribute("disabled", "");
                    this.button.textContent = "Adding...";
                    await addAlbum(this.data.ids.spotify);
                    this.inLibrary = true;
                }
                finally {
                    this.update();
                }
            }
        }
    }
    // -----------
    // File Upload
    // -----------
    function dropFileUpload(evt) {
        evt.preventDefault();
        uploadLibraryFiles(evt.dataTransfer.files);
    }
    function dropFileError(evt) {
        evt.preventDefault();
        toast("Tried to upload a file while a file is still processing");
    }
    main.addEventListener("dragover", evt => {
        evt.preventDefault();
    });
    main.addEventListener("drop", dropFileError);
    const fileInput = document.createElement("input");
    fileInput.setAttribute("type", "file");
    fileInput.setAttribute("accept", ".json");
    fileInput.addEventListener("change", () => {
        if (fileInput.files !== null) {
            uploadLibraryFiles(fileInput.files);
        }
    });
    const upload = document.getElementById("upload");
    function fileClickUpload() {
        fileInput.click();
    }
    function enableUploads() {
        main.removeEventListener("drop", dropFileError);
        main.addEventListener("drop", dropFileUpload);
        upload.addEventListener("click", fileClickUpload);
        upload.removeAttribute("disabled");
    }
    function disableUploads() {
        main.removeEventListener("drop", dropFileUpload);
        main.addEventListener("drop", dropFileError);
        upload.removeEventListener("click", fileClickUpload);
        upload.setAttribute("disabled", "");
    }
    /** Given a file list, add them to active data */
    async function uploadLibraryFiles(files) {
        try {
            disableUploads();
            if (files.length === 0) {
                return;
            }
            else if (files.length > 1) {
                throw "Can't upload more than one file";
            }
            const file = files[0];
            if (file.type !== "application/json") {
                throw "Only json files are supported for upload";
            }
            const library = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    try {
                        resolve(JSON.parse(reader.result));
                    }
                    catch (err) {
                        reject(err);
                    }
                });
                reader.addEventListener("error", evt => {
                    reject(evt);
                });
                reader.readAsText(file);
            });
            setFileData(library.playlists, library.albums);
        }
        catch (err) {
            toast(err);
        }
        finally {
            enableUploads();
        }
    }
    /** Set internal data with playlist and album breakdown */
    function setFileData(plays, albs) {
        clearItems();
        for (const play of plays) {
            const item = new PlaylistItem(play);
            itemList.appendChild(item.element);
            playlists.push(item);
        }
        for (const alb of albs) {
            const item = new AlbumItem(alb);
            itemList.appendChild(item.element);
            albums.push(item);
        }
        matchAndCheckLibrary();
    }
    /** Clear all items */
    function clearItems() {
        itemList.innerHTML = "";
        playlists.length = 0;
        albums.length = 0;
        disableAddAll();
    }
    /** Make sure everything in the library has attempted to be matched with
     * spotify and then check for presence in library
     */
    async function matchAndCheckLibrary() {
        if (access !== undefined) {
            await Promise.all(items().reverse().map(i => i.sync()));
            console.log("finished matching");
            await findLibrary();
        }
    }
    /** Find all items in your spotify library */
    async function findLibrary() {
        disableAddAll();
        resetFoundPlaylists();
        await Promise.all(items().reverse().map(i => i.find()));
        console.log("finished finding");
        if (items().some(i => i.clickable())) {
            enableAddAll();
        }
    }
    /** Try to load existing data. If this fails it just means it wasn't
     * formatted properly or didn't exist
     */
    try {
        setFileData(JSON.parse(localStorage.playlists), JSON.parse(localStorage.albums));
    }
    catch (_) {
    }
    finally {
        enableUploads();
    }
})();
