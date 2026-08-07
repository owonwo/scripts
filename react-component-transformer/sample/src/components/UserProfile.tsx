export default UserProfile;

type UserProfileProps = {
      name: string,
      email: string
    };

function UserProfile(props: UserProfileProps) {

      const {
      name,
      email
    } = props;

      return (
        <div>
          <h1>{name}</h1>
          <p>{email}</p>
        </div>
      );
}
