interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary";
}

export function Button({ label, variant = "primary" }: ButtonProps) {

  return <button className={`btn-${variant}`}>{label}</button>;
}
