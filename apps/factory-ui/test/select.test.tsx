import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Select, type SelectOption } from '../src/components/Select';
import { Dialog } from '../src/components/Dialog';
import { chooseOption } from './select-helpers';

const options: SelectOption[] = [
  { value: '', label: 'All kinds' },
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'berry', label: 'Berry', disabled: true },
  { value: 'cherry', label: 'Cherry' },
];

function Picker({ onChange = () => {}, disabled = false, initial = 'apple' }: { onChange?: (value: string) => void; disabled?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><label htmlFor="fruit">Fruit</label><Select id="fruit" value={value} onValueChange={next => { setValue(next); onChange(next); }} options={options} disabled={disabled} /></>;
}

it('shows the selected label and follows controlled value updates', () => {
  const view = render(<Select aria-label="Fruit" value="apple" onValueChange={() => {}} options={options} />);
  expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('Apple');
  view.rerender(<Select aria-label="Fruit" value="banana" onValueChange={() => {}} options={options} />);
  expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('Banana');
});

it('shows a placeholder when no empty option is provided', () => {
  render(<Select aria-label="Fruit" value="" onValueChange={() => {}} options={options.slice(1)} placeholder="Choose fruit" />);
  expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('Choose fruit');
});

it.each(['{Enter}', '{ArrowDown}'])('opens with %s and selects with arrow keys and Enter', async key => {
  const user = userEvent.setup(); const onChange = vi.fn(); render(<Picker onChange={onChange} />);
  await user.tab(); await user.keyboard(key);
  const listbox = screen.getByRole('listbox');
  expect(document.activeElement).toBe(within(listbox).getByRole('option', { name: 'Apple' }));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('banana');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Fruit' })));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('Banana');
});

it('uses type-ahead to find an option and skips disabled items', async () => {
  const user = userEvent.setup(); const onChange = vi.fn(); render(<Picker onChange={onChange} />);
  await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
  expect(screen.getByRole('option', { name: 'Berry' }).getAttribute('aria-disabled')).toBe('true');
  await user.keyboard('ch');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Cherry' })));
  await user.keyboard('{Enter}');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('cherry');
  await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
  await user.keyboard('{ArrowUp}{Enter}');
  expect(onChange).toHaveBeenLastCalledWith('banana');
});

it('Escape closes without changing the value and returns focus', async () => {
  const user = userEvent.setup(); const onChange = vi.fn(); render(<Picker onChange={onChange} />);
  const trigger = screen.getByRole('combobox', { name: 'Fruit' });
  await user.click(trigger); await user.keyboard('{ArrowDown}{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull(); expect(onChange).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('maps the empty option back to an empty string', async () => {
  const onChange = vi.fn(); render(<Picker onChange={onChange} />);
  await chooseOption('Fruit', 'All kinds');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('');
  expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('All kinds');
});

it('renders an initial empty value as the matching label', () => {
  render(<Picker initial="" />);
  expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('All kinds');
});

it('does not open a disabled control', async () => {
  const user = userEvent.setup(); const onChange = vi.fn(); render(<Picker disabled onChange={onChange} />);
  const trigger = screen.getByRole('combobox', { name: 'Fruit' }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true); await user.click(trigger); await user.tab(); await user.keyboard('{Enter}');
  expect(screen.queryByRole('listbox')).toBeNull(); expect(onChange).not.toHaveBeenCalled();
});

it('keeps a named value in form data', async () => {
  render(<form aria-label="Fruit form"><Select aria-label="Fruit" name="fruit" required value="banana" onValueChange={() => {}} options={options} /></form>);
  const form = screen.getByRole('form', { name: 'Fruit form' }) as HTMLFormElement;
  expect(new FormData(form).get('fruit')).toBe('banana');
  expect(screen.getByRole('combobox', { name: 'Fruit' }).getAttribute('aria-required')).toBe('true');
});

it('portals into a Dialog and retains focus through selection and Escape', async () => {
  const user = userEvent.setup(); const onClose = vi.fn();
  render(<Dialog labelledBy="dialog-title" onClose={onClose}><h2 id="dialog-title">Edit fruit</h2><Picker /><button type="button">Save</button></Dialog>);
  const dialog = screen.getByRole('dialog', { name: 'Edit fruit' });
  const trigger = within(dialog).getByRole('combobox', { name: 'Fruit' });
  await user.click(trigger);
  const listbox = within(dialog).getByRole('listbox');
  expect(dialog.contains(listbox)).toBe(true); expect(listbox.contains(document.activeElement)).toBe(true);
  await user.click(within(listbox).getByRole('option', { name: 'Banana' }));
  expect(screen.getByRole('dialog')).toBe(dialog); expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.textContent).toBe('Banana');
  await user.click(trigger); await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull(); expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.keyboard('{Escape}'); expect(onClose).toHaveBeenCalledOnce();
});
