import { useEffect } from "react";

const SITE_SUFFIX = "Homestand";

/** Sets the browser tab title to `Title | Homestand` */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | ${SITE_SUFFIX}`;
  }, [title]);
}
