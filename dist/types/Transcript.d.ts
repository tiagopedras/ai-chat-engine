import type { ChatController, ChatView } from './controller';
interface Props {
    view: ChatView;
    controller: ChatController;
    onEdit: (text: string) => void;
}
export declare function Transcript({ view, controller, onEdit }: Props): import("react").JSX.Element;
export {};
