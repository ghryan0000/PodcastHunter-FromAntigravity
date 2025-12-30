import React from 'react';

const TitleBar: React.FC = () => {
    return (
        <div
            className="h-10 w-full flex items-center justify-center bg-transparent sticky top-0 z-[60] select-none"
            style={{ WebkitAppRegion: 'drag' } as any}
        >
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.3em] pl-14">
                PodcastHunter & AudioWriter
            </span>
        </div>
    );
};

export default TitleBar;
