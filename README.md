# SBot

## Party voice channels

Use `/party game:<game>` to create a private voice channel for a game. The chosen game's role can join, and the command pings that role. The channel has a player limit and is deleted when the last human participant leaves.

Channels that are still empty or contain only bots after five minutes are also deleted. New channels use the reserved name `sbot-party-<gameKey>-<hostId>` so the bot can recover them after a restart. On startup, channels with this marker and the expected party permission overwrites are tracked again; those without human participants are deleted. Older unmarked channels, renamed channels, and channels whose game role configuration or required permissions no longer match are preserved for manual cleanup.

Configure games in `src/lib/party-data.ts`. The three entries are examples; replace their labels, player limits, and role environment variables with your server's games and role IDs. Set `PARTY_ROLE_MINECRAFT`, `PARTY_ROLE_VALORANT`, and `PARTY_ROLE_FORTNITE` to the corresponding Discord role IDs when using the examples.
