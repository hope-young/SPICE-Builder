const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 找最近一段 onMouseDown={onOverlayMouseDown} 的函数体: 在哪里定义?
const fnStart = src.indexOf('const onOverlayMouseDown');
const fnEnd = src.indexOf('}, [', fnStart) + 3;
console.log('fn definition:', src.substring(fnStart, fnStart + 200));
// 找 onOverlayMouseDown useCallback + 函数体
const onMoveUseEffect = src.indexOf('useEffect(() => {', src.indexOf('onOverlayMouseDown'));
console.log('onMove effect at:', onMoveUseEffect);