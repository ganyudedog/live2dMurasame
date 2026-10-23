# AstrBot QQ bridge

This is a renderer plugin consumer of the public contract in `src/app/core/plugin`. Its WebSocket protocol, settings card, and application-specific behavior stay in this folder. The core plugin host knows only the declared capabilities and renders the plugin-provided settings card.

The control-panel plugin page configures the bridge URL, token, model, reasoning depth, interaction policy, display/speech text languages, and this plugin's system prompt. Settings are stored in Electron under this plugin's own namespace and synchronized to the pet renderer. The plugin selects its queue/interrupt/concurrent policy when opening a conversation channel; this does not change desktop chat behavior.

The `speak_text` response is text only. Audio delivery is not part of this bridge capability yet. Conversation memory is not currently connected to an archive by this frontend plugin.


All discovered plugins are activated by default. Configure connections through the control panel; no plugin environment variables or enable/disable controls are used yet.
