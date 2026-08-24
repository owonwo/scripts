export default UserProfile;

function UserProfile({ name, email }: {
  name: string;
  email: string;
}) {
  return (
    <div>
      <h1>{name}</h1>
      <p>{email}</p>
    </div>
  );
}
