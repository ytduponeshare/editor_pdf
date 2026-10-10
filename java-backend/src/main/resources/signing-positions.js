(() => {
  const pages = Array.from(document.querySelectorAll('.pdf-page'));
  return Array.from(document.querySelectorAll('[data-contract-overlay]')).map(control => {
    const page = control.closest('.pdf-page');
    const box = control.querySelector('.pdf-floating-box') || control;
    if (!page) throw new Error('签署控件没有所属页面');
    const pageRect = page.getBoundingClientRect();
    const rect = box.getBoundingClientRect();
    const position = {
      fieldId: control.dataset.fieldId,
      refId: control.dataset.refId || '',
      fieldType: control.dataset.fieldType,
      pageNumber: pages.indexOf(page) + 1,
      x: rect.left - pageRect.left,
      y: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height,
      unit: 'px',
      origin: 'top-left'
    };
    if (!position.fieldId || ![position.x, position.y, position.width, position.height].every(Number.isFinite)
        || position.width <= 0 || position.height <= 0
        || position.x < -1 || position.y < -1
        || position.x + position.width > pageRect.width + 1
        || position.y + position.height > pageRect.height + 1) {
      throw new Error('签署控件坐标无效或超出页面: ' + (position.fieldId || 'unknown'));
    }
    return position;
  });
})();
