interface FeatureCardProps {
  title: string;
  description: string;
  icon: string;
}

export function FeatureCard({ title, description, icon }: FeatureCardProps) {
  return (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      <span>{icon}</span>
    </div>
  );
}
