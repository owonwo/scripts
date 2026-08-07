export default Box;

type BoxProps = {
      boxes: number,
      count: string
    };

function Box(props: BoxProps) {

      const {
      boxes,
      count
    } = props;

      return (
        <div>
          {boxes} - {count}
        </div>
      );
}
