import type { ContactResponse } from '../lib/contact';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const form = document.querySelector<HTMLFormElement>('[data-contact-form]');

if (form) {
  const fields = Array.from(form.querySelectorAll<Field>('[data-field]'));
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  const success = document.querySelector<HTMLElement>('[data-form-success]');
  const demoNote = document.querySelector<HTMLElement>('[data-demo-note]');
  const fallbackEmail = form.dataset.email ?? '';

  form.noValidate = true;

  const errorFor = (field: Field) => {
    const { validity } = field;
    if (validity.valid) return '';
    if (validity.valueMissing) return field.dataset.requiredMessage ?? 'This field is required.';
    if (validity.typeMismatch) return 'Please enter a valid email address, like name@example.com.';
    if (validity.tooShort && 'minLength' in field) return `Please write at least ${field.minLength} characters.`;
    if (validity.tooLong && 'maxLength' in field) return `Please keep this under ${field.maxLength} characters.`;
    return 'Please check this field.';
  };

  const showError = (field: Field, message: string) => {
    const output = document.getElementById(`${field.id}-error`);
    if (output) output.textContent = message;
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  };

  const setStatus = (message: string, tone: 'info' | 'error' = 'info') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  };

  const setBusy = (busy: boolean) => {
    if (!submit) return;
    submit.disabled = busy;
    submit.setAttribute('aria-busy', String(busy));
    const label = submit.querySelector('[data-label]');
    if (label) label.textContent = busy ? 'Sending' : 'Send message';
  };

  for (const field of fields) {
    field.addEventListener('blur', () => {
      if (field.value.trim() !== '' || field.hasAttribute('aria-invalid')) showError(field, errorFor(field));
    });
    field.addEventListener('input', () => {
      if (field.hasAttribute('aria-invalid')) showError(field, errorFor(field));
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    let firstInvalid: Field | undefined;
    for (const field of fields) {
      const message = errorFor(field);
      showError(field, message);
      if (message && !firstInvalid) firstInvalid = field;
    }
    if (firstInvalid) {
      setStatus('Please fix the highlighted fields and try again.', 'error');
      firstInvalid.focus();
      return;
    }

    setBusy(true);
    setStatus('Sending your message.');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      const result = (await response.json()) as ContactResponse;

      if (result.ok) {
        form.reset();
        form.hidden = true;
        if (demoNote) demoNote.hidden = result.mode !== 'demo';
        if (success) {
          success.hidden = false;
          success.focus();
        }
        return;
      }

      for (const [name, message] of Object.entries(result.fields ?? {})) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLElement) showError(field as Field, message);
      }
      setStatus(result.error, 'error');
    } catch {
      setStatus(`Something went wrong on our side. Please try again, or email ${fallbackEmail}.`, 'error');
    } finally {
      setBusy(false);
    }
  });
}
