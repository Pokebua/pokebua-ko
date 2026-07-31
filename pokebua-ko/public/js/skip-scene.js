(() => {
  const SCENE_DURATION = 5200;
  const SIGN_DELAY = 3600;
  const SIGN_DURATION = 1400;

  let rootElement = null;
  let hideTimer = null;
  let signTimer = null;

  function cleanName(value) {
    const name = String(value ?? "").trim();

    if (!name) {
      return "Kunde";
    }

    return name.split(/\s+/)[0];
  }

  function buildScene() {
    if (rootElement) {
      return rootElement;
    }

    rootElement = document.createElement("div");
    rootElement.id = "skipScene";
    rootElement.className = "skipscene";
    rootElement.setAttribute("aria-hidden", "true");

    rootElement.innerHTML = `
      <div class="skipscene-media">
        <video
  class="skipscene-video"
  src="/assets/skip-scene.mp4"
  muted
  playsinline
  preload="auto"
></video>
         
      </div>

      <div class="skipscene-sign-wrap">
        <div class="skipscene-sign">
          <div class="skipscene-title">
            SKIP THE LINE
          </div>

          <div
            id="skipSceneName"
            class="skipscene-name"
          >
            Kunde
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(rootElement);

    return rootElement;
  }

  function restartGif(scene) {
    const image = scene.querySelector(".skipscene-gif");

    if (!image) {
      return;
    }

    const source = image.getAttribute("src").split("?")[0];

    image.setAttribute(
      "src",
      `${source}?restart=${Date.now()}`
    );
  }

  function stop() {
    clearTimeout(hideTimer);
    clearTimeout(signTimer);

    hideTimer = null;
    signTimer = null;

    const scene = buildScene();

    scene.classList.remove("show", "show-sign");
    scene.setAttribute("aria-hidden", "true");
  }

  function play(name) {
    const scene = buildScene();

    clearTimeout(hideTimer);
    clearTimeout(signTimer);

    scene.classList.remove("show", "show-sign");
    scene.setAttribute("aria-hidden", "true");

    const nameElement =
      scene.querySelector("#skipSceneName");

    if (nameElement) {
      nameElement.textContent = cleanName(name);
    }

    restartGif(scene);

    void scene.offsetWidth;

    scene.setAttribute("aria-hidden", "false");
    scene.classList.add("show");

    signTimer = setTimeout(() => {
      scene.classList.add("show-sign");
    }, SIGN_DELAY);

    hideTimer = setTimeout(() => {
      stop();
    }, SCENE_DURATION + SIGN_DURATION);
  }

  buildScene();

  window.PokebuaSkipScene = {
    play,
    stop
  };
})();
