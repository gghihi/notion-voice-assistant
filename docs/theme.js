// 一打開就套用上次選的深淺色，避免畫面閃一下
try { var t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
