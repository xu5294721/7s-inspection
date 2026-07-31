export interface ChecklistRoute {
  id: string;
  name: string;
}

interface ChecklistRouteListProps {
  routes: ChecklistRoute[];
  selectedItemIds: ReadonlySet<string>;
  onToggle(itemId: string): void;
}

export function ChecklistRouteList({
  routes,
  selectedItemIds,
  onToggle,
}: ChecklistRouteListProps) {
  return (
    <ul className="route-list">
      {routes.map((route) => (
        <li key={route.id}>
          <label className="route-option">
            <input
              type="checkbox"
              aria-label={route.name}
              checked={selectedItemIds.has(route.id)}
              onChange={() => onToggle(route.id)}
            />
            <span className="route-option__name">{route.name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
