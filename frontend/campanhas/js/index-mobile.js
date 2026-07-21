(function () {
  function showManual() {
    var section = document.getElementById('manualChoice');
    if (section) section.classList.remove('hidden');
  }

  function redirectTo(target) {
    window.location.replace(target);
  }

  var appId = null;
  try {
    if (window && window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
      appId = window.Capacitor.appId || null;
    }
  } catch (e) {
    appId = null;
  }

  if (appId === 'com.oddrive.motorista') {
    return redirectTo('driver-mobile.html');
  }
  if (appId === 'com.oddrive.grafica') {
    return redirectTo('graphic-mobile.html');
  }

  var path = (window.location && window.location.pathname ? window.location.pathname : '').toLowerCase();
  if (path.includes('driver')) {
    return redirectTo('driver-mobile.html');
  }
  if (path.includes('graphic')) {
    return redirectTo('graphic-mobile.html');
  }

  showManual();
})();
