# Video Embed Block — Performance-Optimized Implementation

## Problem/Feature Description

The editorial team at GlobalMedia Group wants to embed YouTube videos on multiple pages of their AEM Edge Delivery Services website. Video embeds are known to be a major source of page performance degradation — loading the YouTube iframe API and player code eagerly means the video player JavaScript starts executing before the user even scrolls to it, hurting Largest Contentful Paint (LCP) scores and Core Web Vitals.

The team needs a `video-embed` block that shows a static thumbnail image with a play button overlay as the initial state. The actual YouTube player should only be loaded and initialized when a user scrolls the block into the visible viewport. The block should support being placed anywhere on the page — including above the fold in hero sections — but must prioritize page performance in all cases by deferring the YouTube API load until it is needed. Authors will add the block to pages by putting the YouTube video URL in a simple one-cell table in Google Docs.

## Output Specification

Create a complete, working implementation of the `video-embed` block including:
- The JavaScript decoration file (at the standard AEM block path)
- The CSS file (at the standard AEM block path)

The implementation should:
- Parse the YouTube URL from the authored content to extract the video ID
- Display a clickable thumbnail as the initial state using YouTube's thumbnail URL format: `https://img.youtube.com/vi/{videoId}/hqdefault.jpg`
- Load the YouTube player only when the block scrolls into view
- Replace the thumbnail with the YouTube iframe once loading is triggered

Do not include the YouTube iframe API `<script>` tag in your HTML — load it dynamically from JavaScript when needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/sample-block-content.html ===============
<!-- This shows the DOM structure the AEM platform delivers to the decorate() function.
     The block receives one div child containing the authored YouTube URL as a paragraph. -->
<div class="video-embed">
  <div>
    <div>
      <p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>
    </div>
  </div>
</div>
