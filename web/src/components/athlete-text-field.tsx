import { useId } from "react";
export function TextField({
  id,
  label,
  value,
  onChange,
  max = 2000,
  required = false,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  required?: boolean;
}) {
  const uniqueId = useId();
  const fieldId = id ?? uniqueId;
  return (
    <div className="athlete-field">
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={max}
        required={required}
        aria-describedby={`${fieldId}-count`}
      />
      <small id={`${fieldId}-count`}>
        {value.length.toLocaleString()} / {max.toLocaleString()}
      </small>
    </div>
  );
}
