import { useEffect } from "react";
import { APP_NAME } from "../libs/constants/appConfig";

export function usePageTitle(pageTitle) {
  useEffect(() => {
    document.title = `${pageTitle} | ${APP_NAME}`;
  }, [pageTitle]);
}
