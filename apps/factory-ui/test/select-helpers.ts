import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export async function chooseOption(label: string | RegExp, option: string | RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}
