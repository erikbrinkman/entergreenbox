Enter the Green Box
===================

A [webapp](https://erikbrinkman.github.io/entergreenbox) to migrate a music library to Spotify. Simply upload a json file with the following Typescript format.

```
{
  playlists: Playlist[],
  albums: Album[],
}
```

where `Playlist` and `Album` are defined as:

```
interface Artist {
  name: string;
}

interface PlatformIds {
  google?: string | null;
  spotify?: string | null;
}

interface Track {
  artists: Artist[];
  duration_ms: number;
  ids: PlatformIds;
  title: string;
  track: number;
  explicit: boolean;
  type: "track";
}

interface Album {
  art: string | null;
  artists: Artist[];
  ids: PlatformIds;
  name: string;
  num_tracks: number;
  tracks: Track[];
  year: number;
  type: "album";
}

interface Playlist {
  name: string;
  description: string;
  tracks: Track[];
  type: "playlist";
} 
```
