interface FeatureCardProps {
  title: string;
  description: string;
  icon: string;
}

export function FeatureCard(props: FeatureCardProps) {

      const { title, description, icon } = props;

      return (
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
          <span>{icon}</span>
        </div>
      );
}
