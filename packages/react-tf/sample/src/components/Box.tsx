export default Box;

function Box(props: {
  boxes: number;
  count: string;
}) {
  const { boxes, count } = props;

  return (
    <div>
      {boxes} - {count}
    </div>
  );
}
