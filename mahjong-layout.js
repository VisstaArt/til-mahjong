// Генерация настоящей многослойной раскладки маджонга (пирамида) + гарантия решаемости.
//
// Координаты x,y — в "полу-плитках" (шаг 2 = одна плитка). Каждый следующий слой
// смещён на +1 по x и y относительно предыдущего и меньше на 1 плитку с каждой
// стороны — так верхняя плитка ложится на стык четырёх нижних, как в настоящем маджонге.

function posKey(p) {
  return `${p.x},${p.y},${p.z}`;
}

// Плитка "накрыта", если в оставшемся наборе есть плитка выше по слою,
// чей контур [x, x+2) x [y, y+2) пересекается с этой.
function isCovered(pos, remaining) {
  for (const p of remaining.values()) {
    if (p.z > pos.z && Math.abs(p.x - pos.x) < 2 && Math.abs(p.y - pos.y) < 2) return true;
  }
  return false;
}

// Плитка "свободна", если не накрыта сверху и открыта хотя бы с одной стороны (лево/право) на своём слое.
function isFree(pos, remaining) {
  if (isCovered(pos, remaining)) return false;
  const leftBlocked = remaining.has(posKey({ x: pos.x - 2, y: pos.y, z: pos.z }));
  const rightBlocked = remaining.has(posKey({ x: pos.x + 2, y: pos.y, z: pos.z }));
  return !leftBlocked || !rightBlocked;
}

// Хвост, который не поместился в форму, — плоским рядом сбоку (редкий краевой случай,
// например когда плиток задано больше, чем форма способна вместить слоями).
function appendTail(positions, remaining, extraX, rows) {
  let i = 0;
  while (remaining > 0) {
    positions.push({ x: extraX + Math.floor(i / rows) * 2, y: (i % rows) * 2, z: 0 });
    i++;
    remaining--;
  }
  return positions;
}

// Пирамида: прямоугольник, с каждым слоем уменьшающийся на 1 плитку с каждой стороны
// и смещающийся на +1 — классическая ступенчатая пирамида.
function generatePyramidShape(tileCount) {
  const area = Math.max(tileCount * 0.45, 16);
  let cols = Math.min(14, Math.max(6, Math.round(Math.sqrt(area * 1.8))));
  let rows = Math.min(8, Math.max(4, Math.round(Math.sqrt(area / 1.8))));

  const positions = [];
  let remaining = tileCount;
  let layer = 0;
  let offset = 0;
  let c = cols;
  let r = rows;

  while (remaining > 0 && c >= 1 && r >= 1) {
    for (let ry = 0; ry < r && remaining > 0; ry++) {
      for (let rx = 0; rx < c && remaining > 0; rx++) {
        positions.push({ x: offset + rx * 2, y: offset + ry * 2, z: layer });
        remaining--;
      }
    }
    layer++;
    offset += 1;
    c -= 2;
    r -= 2;
  }

  if (remaining > 0) appendTail(positions, remaining, cols * 2 + 4, rows);
  return positions;
}

// Крепость: та же ступенчатая логика, что у пирамиды, но почти квадратная и с более
// медленным сужением (на 1 плитку с каждой стороны за слой вместо 1 с каждой) —
// получается более приземистая и высокая башня вместо длинной низкой пирамиды.
function generateFortressShape(tileCount) {
  const area = Math.max(tileCount * 0.45, 16);
  let side = Math.min(11, Math.max(6, Math.round(Math.sqrt(area * 1.15))));
  let cols = side;
  let rows = side;

  const positions = [];
  let remaining = tileCount;
  let layer = 0;
  let offset = 0;
  let c = cols;
  let r = rows;

  while (remaining > 0 && c >= 1 && r >= 1) {
    for (let ry = 0; ry < r && remaining > 0; ry++) {
      for (let rx = 0; rx < c && remaining > 0; rx++) {
        positions.push({ x: offset + rx * 2, y: offset + ry * 2, z: layer });
        remaining--;
      }
    }
    layer++;
    offset += 1;
    c -= 1;
    r -= 1;
  }

  if (remaining > 0) appendTail(positions, remaining, cols * 2 + 4, rows);
  return positions;
}

// Черепаха: широкий овальный панцирь (слой 0) + меньший овальный горб по центру
// (слой 1) + маленький пик (слой 2) — силуэт вместо прямоугольника считается
// по уравнению эллипса на каждом слое.
function generateTurtleShape(tileCount) {
  const area = Math.max(tileCount * 0.5, 16);
  const cols = Math.min(16, Math.max(8, Math.round(Math.sqrt(area * 2.6))));
  const rows = Math.min(9, Math.max(5, Math.round(Math.sqrt(area / 2.6))));
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;

  function ellipseCells(shrink, z) {
    const rx = (cols / 2) * shrink;
    const ry = (rows / 2) * shrink;
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const nx = rx ? (col - cx) / rx : 0;
        const ny = ry ? (row - cy) / ry : 0;
        if (nx * nx + ny * ny <= 1) cells.push({ x: col * 2 + z, y: row * 2 + z, z });
      }
    }
    return cells;
  }

  const layers = [ellipseCells(1, 0), ellipseCells(0.55, 1), ellipseCells(0.28, 2)];
  const positions = [];
  let remaining = tileCount;
  layers.forEach((cells) => {
    for (const p of cells) {
      if (remaining <= 0) return;
      positions.push(p);
      remaining--;
    }
  });

  if (remaining > 0) appendTail(positions, remaining, cols * 2 + 6, rows);
  return positions;
}

const SHAPE_GENERATORS = {
  pyramid: generatePyramidShape,
  fortress: generateFortressShape,
  turtle: generateTurtleShape,
};

function generateShape(tileCount, shapeId) {
  const gen = SHAPE_GENERATORS[shapeId] || generatePyramidShape;
  return gen(tileCount);
}

// Строит гарантированно решаемый порядок снятия пар: на каждом раунде снимает
// ВСЕ свободные плитки, разбивая их на случайные пары. Раз плитки только
// освобождаются по мере снятия соседей, дойти до конца можно всегда.
function computeRemovalOrder(positions) {
  const remaining = new Map(positions.map((p) => [posKey(p), p]));
  const order = [];

  while (remaining.size > 0) {
    let free = [...remaining.values()].filter((p) => isFree(p, remaining));

    if (free.length < 2) {
      // Подстраховка на случай вырожденной формы — не должно случаться для нормальной пирамиды.
      const rest = [...remaining.values()];
      for (let i = 0; i + 1 < rest.length; i += 2) order.push([rest[i], rest[i + 1]]);
      break;
    }

    // перемешать
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }

    for (let i = 0; i + 1 < free.length; i += 2) {
      remaining.delete(posKey(free[i]));
      remaining.delete(posKey(free[i + 1]));
      order.push([free[i], free[i + 1]]);
    }
  }

  return order;
}

// deck: [{tr, ru, icon}], одна запись на пару (уже взвешенный/растянутый под нужное
// число пар список слов — см. buildWeightedDeck в script.js). tileCount: чётное
// число плиток. shapeId: "pyramid" | "turtle" | "fortress".
// Возвращает массив плиток с координатами x,y,z и гарантией решаемости.
function buildLayeredBoard(deck, tileCount, shapeId) {
  const pairsNeeded = Math.max(1, Math.floor(tileCount / 2));
  const shape = generateShape(pairsNeeded * 2, shapeId);
  const order = computeRemovalOrder(shape);

  const tiles = [];
  let id = 0;
  order.forEach(([posA, posB], i) => {
    const w = deck[i % deck.length];
    const isImageFirst = Math.random() < 0.5;
    const imagePos = isImageFirst ? posA : posB;
    const wordPos = isImageFirst ? posB : posA;
    // pairId = само слово (tr), а не номер слота: любые повторы одного слова
    // взаимозаменяемы, как одинаковые плитки в настоящем маджонге. Это не ломает
    // решаемость — только добавляет дополнительные допустимые ходы к уже гарантированным.
    tiles.push({
      id: id++,
      pairId: w.tr,
      type: "image",
      tr: w.tr,
      ru: w.ru,
      icon: w.icon,
      x: imagePos.x,
      y: imagePos.y,
      z: imagePos.z,
      matched: false,
    });
    tiles.push({
      id: id++,
      pairId: w.tr,
      type: "word",
      tr: w.tr,
      ru: w.ru,
      icon: w.icon,
      x: wordPos.x,
      y: wordPos.y,
      z: wordPos.z,
      matched: false,
    });
  });
  return tiles;
}

// Свободна ли конкретная плитка board-массива с учётом того, что уже снято (matched).
function isTileFree(tile, allTiles) {
  const remaining = new Map(
    allTiles.filter((t) => !t.matched).map((t) => [posKey(t), t])
  );
  return isFree(tile, remaining);
}
