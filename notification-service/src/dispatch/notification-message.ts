/** JSON body consumed by `frontend/public/service-worker.js`. */
export interface NotificationMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}
