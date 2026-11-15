// Browser MCP diagnostic: validate that a custom component is registered and loaded.
// Usage: evaluate in the page with any browser tool (Playwright, Chrome DevTools MCP, etc.)
// and call the returned function with the component name.
// Returns { status, checks[], message }
(function validateComponent(componentName) {
  const results = { status: 'pass', checks: [], message: '' };

  function check(name, pass, detail) {
    results.checks.push({ name, pass, detail });
    if (!pass) results.status = 'fail';
  }

  // 1. Resolve the form model
  let form = null;
  if (window.myForm) {
    form = window.myForm;
    check('Form model', true, 'Found via window.myForm');
  } else if (typeof guideBridge !== 'undefined') {
    try { form = guideBridge.getFormModel(); } catch (_) {}
    if (form) check('Form model', true, 'Found via guideBridge.getFormModel()');
  }
  if (!form) {
    check('Form model', false, 'No form model found. Ensure the form is loaded.');
    results.message = 'Cannot validate — no form model on page.';
    return results;
  }

  // 2. Check if a field uses this component (via :type set by fd:viewType in JSON schema)
  let matchedField = null;
  const allFields = [];
  function collectFields(node) {
    if (!node) return;
    const type = node[':type'] || node._jsonModel?.[':type'] || '';
    const variant = node.properties?.variant || node._jsonModel?.properties?.variant || '';
    allFields.push({ id: node.id, name: node.name, type, variant, fieldType: node.fieldType });
    if (!matchedField && (type === componentName || variant === componentName)) {
      matchedField = node;
    }
    if (node.items) node.items.forEach(collectFields);
  }
  collectFields(form);

  if (matchedField) {
    check('Field using component', true,
      'Field "' + (matchedField.id || matchedField.name) + '" uses ' + componentName +
      ' (:type=' + (matchedField[':type'] || '') + ')');
  } else {
    check('Field using component', false,
      'No field found with :type or properties.variant matching "' + componentName + '". ' +
      'Available :types: ' + [...new Set(allFields.map(f => f.type).filter(Boolean))].join(', '));
  }

  // 3. Check DOM element loaded
  if (matchedField) {
    const fieldEl = document.querySelector('[data-id="' + matchedField.id + '"]');
    if (fieldEl) {
      const status = fieldEl.dataset.componentStatus;
      if (status === 'loaded') {
        check('DOM component loaded', true, 'Element with data-id="' + matchedField.id + '" has componentStatus=loaded');
      } else if (status === 'loading') {
        check('DOM component loaded', false, 'Component is still loading (componentStatus=loading)');
      } else {
        check('DOM component loaded', false,
          'Element found but no componentStatus. Verify "' + componentName + '" is in customComponents or OOTBComponentDecorators in mappings.js');
      }
    } else {
      check('DOM component loaded', false, 'No DOM element found with data-id="' + matchedField.id + '"');
    }
  }

  // 4. Registration hint
  check('Registration hint', true,
    'Ensure "' + componentName + '" is listed in customComponents or OOTBComponentDecorators in blocks/form/mappings.js');

  results.message = results.status === 'pass'
    ? 'Component "' + componentName + '" is registered and loaded.'
    : 'Component "' + componentName + '" has issues. See checks above.';

  return results;
})
