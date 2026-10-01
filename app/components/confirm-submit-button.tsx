"use client";

import { useFormStatus } from "react-dom";

type ConfirmSubmitButtonProps = {
  className?: string;
  confirmMessage: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  label: string;
  name?: string;
  pendingLabel?: string;
  value?: string;
};

export function ConfirmSubmitButton({
  className = "",
  confirmMessage,
  formAction,
  label,
  name,
  pendingLabel = "Saving…",
  value,
}: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending}
      formAction={formAction}
      name={name}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      type="submit"
      value={value}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
