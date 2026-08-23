interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary";
}

export function Button(props: ButtonProps) {
  const { label, variant = "primary" } = props;

  return <button className={`btn-${variant}`}>{label}</button>;
}
