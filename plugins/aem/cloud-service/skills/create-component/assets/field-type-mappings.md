# Field Type Mappings

Quick reference for mapping user field specifications to Granite UI resource types.

## Dialog Field Types

| User Says | Granite Resource Type | Property Type |
| --- | --- | --- |
| Textfield, Text, String | granite/ui/components/coral/foundation/form/textfield | String |
| Textarea | granite/ui/components/coral/foundation/form/textarea | String |
| Richtext, RTE, Rich Text | cq/gui/components/authoring/dialog/richtext | String (HTML) |
| Checkbox, Boolean | granite/ui/components/coral/foundation/form/checkbox | Boolean |
| Select, Dropdown, Options | granite/ui/components/coral/foundation/form/select | String |
| Pathfield, Path, Link | granite/ui/components/coral/foundation/form/pathfield | String (Path) |
| Image, Photo | Embed Core Image component via data-sly-resource (see references/htl-patterns.md Image Handling section). Do not use fileupload for image rendering. | N/A (embedded component) |
| Fileupload, File Upload, File | cq/gui/components/authoring/dialog/fileupload (for non-image files: PDFs, documents) | Resource |
| Numberfield, Number | granite/ui/components/coral/foundation/form/numberfield | Long/Double |
| Datepicker, Date | granite/ui/components/coral/foundation/form/datepicker | Date |
| Multifield, List, Array | granite/ui/components/coral/foundation/form/multifield | List |
| Hidden | granite/ui/components/coral/foundation/form/hidden | String |
| Colorfield, Color | granite/ui/components/coral/foundation/form/colorfield | String |

## Core Component Mappings

| User Says | Core Component Path | Version |
| --- | --- | --- |
| image | core/wcm/components/image/v3/image | v3 |
| teaser, card | core/wcm/components/teaser/v2/teaser | v2 |
| text, richtext | core/wcm/components/text/v2/text | v2 |
| title, heading | core/wcm/components/title/v3/title | v3 |
| list | core/wcm/components/list/v4/list | v4 |
| button, cta | core/wcm/components/button/v2/button | v2 |
| navigation, nav | core/wcm/components/navigation/v2/navigation | v2 |
| container, section | core/wcm/components/container/v1/container | v1 |
| accordion | core/wcm/components/accordion/v1/accordion | v1 |
| tabs | core/wcm/components/tabs/v1/tabs | v1 |
| carousel | core/wcm/components/carousel/v1/carousel | v1 |
| embed, video | core/wcm/components/embed/v2/embed | v2 |
| separator | core/wcm/components/separator/v1/separator | v1 |
| download | core/wcm/components/download/v2/download | v2 |
| breadcrumb | core/wcm/components/breadcrumb/v3/breadcrumb | v3 |
| search | core/wcm/components/search/v2/search | v2 |
| contentfragment | core/wcm/components/contentfragment/v1/contentfragment | v1 |
| experiencefragment | core/wcm/components/experiencefragment/v2/experiencefragment | v2 |
| pdfviewer | core/wcm/components/pdfviewer/v1/pdfviewer | v1 |
| progressbar | core/wcm/components/progressbar/v1/progressbar | v1 |

## Sling Model Annotation Mappings

| Dialog Field | Model Annotation | Java Type |
| --- | --- | --- |
| Textfield | @ValueMapValue | String |
| Textarea | @ValueMapValue | String |
| Richtext | @ValueMapValue | String |
| Checkbox | @ValueMapValue | boolean |
| Select | @ValueMapValue | String |
| Pathfield | @ValueMapValue | String |
| Numberfield | @ValueMapValue | int, long, double |
| Datepicker | @ValueMapValue | Calendar, Date |
| Fileupload | @ChildResource | Resource |
| Simple Multifield | @ValueMapValue | List<String> |
| Composite Multifield | @ChildResource | List<Resource> |

## Name Transformation Rules

| Input | Component Folder | Model Class | CSS Prefix |
| --- | --- | --- | --- |
| hero-banner | hero-banner | HeroBannerModel | cmp-hero-banner |
| tiles-list | tiles-list | TilesListModel | cmp-tiles-list |
| My Component | my-component | MyComponentModel | cmp-my-component |
| card carousel | card-carousel | CardCarouselModel | cmp-card-carousel |