/** Whether the lab can be started from this availability state. Everything else is read-only: the instructions stay visible, the terminal does not start. */
export const isReadOnly = (state) => state?.state === 'no_slot' || state?.state === 'blocked';
