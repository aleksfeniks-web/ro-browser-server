/**
 * WebRO - A* Pathfinding algorithm for 8-directional movement
 */
class Pathfinding {
  static findPath(mapGrid, start, end) {
    const width = mapGrid[0].length;
    const height = mapGrid.length;

    const startX = Math.round(start.x);
    const startY = Math.round(start.y);
    const endX = Math.round(end.x);
    const endY = Math.round(end.y);

    // Si el destino es bloqueado o igual al inicio, no hay ruta
    if (this.isBlocked(mapGrid, endX, endY) || (startX === endX && startY === endY)) {
      return [];
    }

    const openList = [];
    const closedList = new Set();

    const startNode = {
      x: startX,
      y: startY,
      g: 0,
      h: this.heuristic({ x: startX, y: startY }, { x: endX, y: endY }),
      f: 0,
      parent: null
    };
    startNode.f = startNode.g + startNode.h;

    openList.push(startNode);

    while (openList.length > 0) {
      // Encontrar nodo con menor F
      openList.sort((a, b) => a.f - b.f);
      const currentNode = openList.shift();
      
      const posKey = `${currentNode.x},${currentNode.y}`;
      closedList.add(posKey);

      // Si llegó al destino
      if (currentNode.x === endX && currentNode.y === endY) {
        const path = [];
        let curr = currentNode;
        while (curr.parent !== null) {
          path.push({ x: curr.x, y: curr.y });
          curr = curr.parent;
        }
        return path.reverse();
      }

      // Direcciones en 8 sentidos (ortogonales + diagonales)
      const neighbors = [
        { x: 0, y: -1, cost: 1 },
        { x: 0, y: 1, cost: 1 },
        { x: -1, y: 0, cost: 1 },
        { x: 1, y: 0, cost: 1 },
        { x: -1, y: -1, cost: 1.4 },
        { x: 1, y: -1, cost: 1.4 },
        { x: -1, y: 1, cost: 1.4 },
        { x: 1, y: 1, cost: 1.4 }
      ];

      for (const dir of neighbors) {
        const nx = currentNode.x + dir.x;
        const ny = currentNode.y + dir.y;

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (this.isBlocked(mapGrid, nx, ny)) continue;

        // Evitar cortar esquinas en diagonal
        if (dir.x !== 0 && dir.y !== 0) {
          if (this.isBlocked(mapGrid, currentNode.x + dir.x, currentNode.y) || 
              this.isBlocked(mapGrid, currentNode.x, currentNode.y + dir.y)) {
            continue;
          }
        }

        const neighborKey = `${nx},${ny}`;
        if (closedList.has(neighborKey)) continue;

        const gScore = currentNode.g + dir.cost;
        let neighborNode = openList.find(n => n.x === nx && n.y === ny);

        if (!neighborNode) {
          neighborNode = {
            x: nx,
            y: ny,
            g: gScore,
            h: this.heuristic({ x: nx, y: ny }, end),
            f: 0,
            parent: currentNode
          };
          neighborNode.f = neighborNode.g + neighborNode.h;
          openList.push(neighborNode);
        } else if (gScore < neighborNode.g) {
          neighborNode.g = gScore;
          neighborNode.f = gScore + neighborNode.h;
          neighborNode.parent = currentNode;
        }
      }
    }

    return []; // No se encontró ruta
  }

  static heuristic(pos0, pos1) {
    // Distancia Octil para 8 direcciones
    const dx = Math.abs(pos0.x - pos1.x);
    const dy = Math.abs(pos0.y - pos1.y);
    return (dx + dy) + (1.4 - 2) * Math.min(dx, dy);
  }

  static isBlocked(grid, x, y) {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return true;
    const tile = grid[y][x];
    return tile === 'T' || tile === '#' || tile === '*' || tile === 'F';
  }
}

// Exportar globalmente
window.Pathfinding = Pathfinding;
