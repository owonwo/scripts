export default Button;

type ButtonProps = { label: string };

function Button(props: ButtonProps) {
  const { label } = props;

  return <button>{label}</button>;
}
