"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  idleLabel: string;
  name?: string;
  pendingLabel: string;
  value?: string;
};

export function SubmitButton({
  className = "",
  formAction,
  idleLabel,
  name,
  pendingLabel,
  value,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending}
      formAction={formAction}
      name={name}
      type="submit"
      value={value}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
