(() => {
  const version = 'real-seed-v2';
  if (localStorage.getItem('hashiTemplateSeedVersion') !== version) {
    localStorage.removeItem('hashiDigitTemplatesV1');
    localStorage.removeItem('hashiDigitTemplatesV2');
    localStorage.setItem('hashiTemplateSeedVersion', version);
  }
})();
