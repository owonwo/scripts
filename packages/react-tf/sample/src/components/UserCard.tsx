
export function UserCard(props: { name: string; email: string }) {
  return (
    <div>
      <h2>{props.name}</h2>
      <p>{props.email}</p>
    </div>
  );
}
