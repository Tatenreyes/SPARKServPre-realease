import { CDO_BARANGAYS } from "@/lib/cdo-barangays";

export default function BarangaySelect({
  id,
  value,
  onChange,
  disabled,
  required,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink/80">
        Barangay{required ? " *" : ""}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        autoComplete="address-level3"
        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm"
      >
        <option value="">Select a Cagayan de Oro barangay</option>
        {CDO_BARANGAYS.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>
  );
}
