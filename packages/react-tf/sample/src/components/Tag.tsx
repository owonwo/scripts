interface TagProps {
  name: string;
}

export function Tag({ name }: TagProps) {
  return <span className="tag">{name}</span>;
}
