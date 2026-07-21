import "stream-chat";

declare module "stream-chat" {
  interface CustomMessageData {
    video_intvie?: boolean;
    url?: string;
  }
  interface CustomChannelData {
    name?: string;
  }
}