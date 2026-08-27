// Chromium loads only this service worker; Firefox loads both manifest scripts.
if (typeof importScripts === "function") {
  importScripts("network-observer.js");
}

console.log("AIDM Stream Inspector background context started.");
