const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Autoclicker
  startAutoclicker: (cfg) => ipcRenderer.send('start-autoclicker', cfg),
  stopAutoclicker:  ()    => ipcRenderer.send('stop-autoclicker'),

  // Macro
  startRecording:   ()         => ipcRenderer.send('start-recording'),
  stopRecording:    ()         => ipcRenderer.send('stop-recording'),
  playMacro:        (options)  => ipcRenderer.send('play-macro', options),
  stopMacro:        ()         => ipcRenderer.send('stop-macro'),
  setMacroEvents:   (events)   => ipcRenderer.send('set-macro-events', events),
  getMacroEvents:   ()         => ipcRenderer.invoke('get-macro-events'),
  getCursorPos:     ()         => ipcRenderer.invoke('get-cursor-pos'),

  // Settings
  loadSettings:     ()         => ipcRenderer.invoke('load-settings'),
  saveSettings:     (ui)       => ipcRenderer.send('save-settings', ui),

  // Hotkeys
  getHotkeys:       ()              => ipcRenderer.invoke('get-hotkeys'),
  setHotkey:        (action, accel) => ipcRenderer.invoke('set-hotkey', { action, accel }),
  suspendHotkeys:   ()              => ipcRenderer.send('suspend-hotkeys'),
  resumeHotkeys:    ()              => ipcRenderer.send('resume-hotkeys'),

  // Perfis
  listProfiles:     ()              => ipcRenderer.invoke('profiles-list'),
  saveProfile:      (name, ui)      => ipcRenderer.invoke('profile-save', { name, ui }),
  loadProfile:      (name)          => ipcRenderer.invoke('profile-load', name),
  deleteProfile:    (name)          => ipcRenderer.invoke('profile-delete', name),
  exportProfile:    (name, ui)      => ipcRenderer.invoke('profile-export', { name, ui }),
  importProfile:    ()              => ipcRenderer.invoke('profile-import'),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // Events from main
  on: (channel, cb) => {
    const allowed = [
      'autoclicker-status', 'click-count',
      'macro-status', 'macro-progress', 'hotkey-toggle-autoclicker', 'hotkey-play-macro'
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => cb(data));
    }
  },
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});
