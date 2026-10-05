import { useNavigate, useParams } from "react-router-dom";

export function useUrlTab<T extends string>(
  basePath: string,
  defaultTab: T,
  validTabs: readonly T[],
): { currentTab: T; setTab: (tab: T) => void } {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const currentTab: T = validTabs.includes(tab as T) ? (tab as T) : defaultTab;

  const setTab = (newTab: T) => {
    navigate(`${basePath}/${newTab}`);
  };

  return { currentTab, setTab };
}
