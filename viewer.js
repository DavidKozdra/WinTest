document.addEventListener("DOMContentLoaded", async () => {
  const canvas = document.getElementById("viewer-canvas");
  const image = document.getElementById("capture-image");
  const message = document.getElementById("viewer-message");
  const label = document.getElementById("capture-label");
  const details = document.getElementById("capture-details");
  const target = document.getElementById("capture-target");
  const captureId = document.getElementById("capture-id");
  const fitButton = document.getElementById("fit-image");
  const actualButton = document.getElementById("actual-image");
  const download = document.getElementById("download-image");
  let imageUrl = null;

  fitButton.addEventListener("click", () => setMode("fit"));
  actualButton.addEventListener("click", () => setMode("actual"));
  image.addEventListener("dblclick", () => setMode(canvas.dataset.mode === "fit" ? "actual" : "fit"));
  document.getElementById("close-viewer").addEventListener("click", () => window.close());
  window.addEventListener("beforeunload", () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  });

  try {
    const id = new URL(location.href).searchParams.get("capture");
    const capture = await WinTestCaptureStore.readCapture(id);
    if (!capture?.blob) throw new Error("This capture is no longer available. Run External verify again.");

    imageUrl = URL.createObjectURL(capture.blob);
    image.src = imageUrl;
    image.hidden = false;
    message.hidden = true;
    label.textContent = capture.label || "External verification";
    details.textContent =
      `${capture.viewportWidth}×${capture.viewportHeight} CSS · DPR ${capture.deviceScaleFactor} · ` +
      `${capture.outputWidth}×${capture.outputHeight} PNG`;
    captureId.textContent = capture.verificationId ? `Verification ${capture.verificationId}` : "";
    target.href = capture.targetUrl;
    target.textContent = capture.targetUrl;
    download.href = imageUrl;
    download.download = capture.filename || `wintest-${capture.outputWidth}x${capture.outputHeight}.png`;
    download.hidden = false;
    document.title = `${capture.label || "Capture"} — WinTest`;
  } catch (error) {
    message.textContent = error.message;
  }

  function setMode(mode) {
    canvas.dataset.mode = mode;
    fitButton.setAttribute("aria-pressed", String(mode === "fit"));
    actualButton.setAttribute("aria-pressed", String(mode === "actual"));
  }
});
