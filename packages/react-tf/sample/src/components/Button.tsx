export default Button;


function Button(props: { label: string }) {
  const { label } = props;

  return <button>{label}</button>;
}
